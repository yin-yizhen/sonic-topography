use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use once_cell::sync::Lazy;
use windows::core::GUID;
use windows::Win32::Media::Audio::{
    eConsole, eRender, IAudioCaptureClient, IAudioClient, IMMDevice, IMMDeviceEnumerator,
    MMDeviceEnumerator, WAVEFORMATEX, WAVEFORMATEXTENSIBLE, WAVE_FORMAT_PCM,
    AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED,
};

const WAVE_FORMAT_IEEE_FLOAT: u16 = 0x0003;
const WAVE_FORMAT_EXTENSIBLE: u16 = 0xFFFE;

const STREAM_HOST: &str = "127.0.0.1";
const STREAM_PORT: u16 = 14500;
const TARGET_CHANNELS: u16 = 2;
const TARGET_BITS_PER_SAMPLE: u16 = 16;

// KSDATAFORMAT_SUBTYPE_* GUIDs (MM/mmreg.h)
const KSDATAFORMAT_SUBTYPE_PCM: GUID = GUID::from_values(
    0x00000001,
    0x0000,
    0x0010,
    [0x80, 0x00, 0x00, 0xAA, 0x00, 0x38, 0x9B, 0x71],
);
const KSDATAFORMAT_SUBTYPE_IEEE_FLOAT: GUID = GUID::from_values(
    0x00000003,
    0x0000,
    0x0010,
    [0x80, 0x00, 0x00, 0xAA, 0x00, 0x38, 0x9B, 0x71],
);

struct CaptureState {
    running: Arc<AtomicBool>,
    capture_thread: Option<JoinHandle<()>>,
    server_thread: Option<JoinHandle<()>>,
}

impl CaptureState {
    fn new() -> Self {
        Self {
            running: Arc::new(AtomicBool::new(false)),
            capture_thread: None,
            server_thread: None,
        }
    }

    fn reset(&mut self) {
        self.capture_thread = None;
        self.server_thread = None;
        self.running.store(false, Ordering::SeqCst);
    }
}

static CAPTURE_STATE: Lazy<Mutex<CaptureState>> =
    Lazy::new(|| Mutex::new(CaptureState::new()));

/// Builds a PCM WAV header for an infinite stream (data chunk size = 0xFFFFFFFF).
fn build_wav_header(sample_rate: u32, channels: u16) -> [u8; 44] {
    let byte_rate = sample_rate * channels as u32 * (TARGET_BITS_PER_SAMPLE as u32 / 8);
    let block_align = channels * (TARGET_BITS_PER_SAMPLE / 8);
    let mut header = [0u8; 44];

    header[0..4].copy_from_slice(b"RIFF");
    header[4..8].copy_from_slice(&0xFFFFFFFFu32.to_le_bytes());
    header[8..12].copy_from_slice(b"WAVE");
    header[12..16].copy_from_slice(b"fmt ");
    header[16..20].copy_from_slice(&16u32.to_le_bytes()); // Subchunk1Size
    header[20..22].copy_from_slice(&WAVE_FORMAT_PCM.to_le_bytes()); // AudioFormat
    header[22..24].copy_from_slice(&channels.to_le_bytes());
    header[24..28].copy_from_slice(&sample_rate.to_le_bytes());
    header[28..32].copy_from_slice(&byte_rate.to_le_bytes());
    header[32..34].copy_from_slice(&block_align.to_le_bytes());
    header[34..36].copy_from_slice(&TARGET_BITS_PER_SAMPLE.to_le_bytes());
    header[36..40].copy_from_slice(b"data");
    header[40..44].copy_from_slice(&0xFFFFFFFFu32.to_le_bytes());

    header
}

/// Parses the WAVEFORMATEX pointer returned by WASAPI and returns sample rate, channels,
/// and a closure that converts raw capture bytes into interleaved i16 samples.
unsafe fn make_format_converter(
    pwf: *const WAVEFORMATEX,
) -> Result<(u32, u16, Box<dyn Fn(&[u8]) -> Vec<u8> + Send>), String> {
    if pwf.is_null() {
        return Err("Null WAVEFORMATEX from device".to_string());
    }

    let wf = &*pwf;
    let sample_rate = wf.nSamplesPerSec;
    let channels = wf.nChannels;

    let format_tag = wf.wFormatTag;
    let bits_per_sample = wf.wBitsPerSample;
    let is_float;

    if format_tag == WAVE_FORMAT_PCM as u16 {
        is_float = false;
    } else if format_tag == WAVE_FORMAT_IEEE_FLOAT {
        is_float = true;
    } else if format_tag == WAVE_FORMAT_EXTENSIBLE {
        let wfe = &*(pwf as *const WAVEFORMATEXTENSIBLE);
        let sub_format = wfe.SubFormat;
        if sub_format == KSDATAFORMAT_SUBTYPE_PCM {
            is_float = false;
        } else if sub_format == KSDATAFORMAT_SUBTYPE_IEEE_FLOAT {
            is_float = true;
        } else {
            return Err(format!("Unsupported EXTENSIBLE sub-format: {:?}", sub_format));
        }
    } else {
        return Err(format!("Unsupported WAVEFORMATEX format tag: {}", format_tag));
    }

    if is_float {
        if bits_per_sample != 32 {
            return Err(format!("Unsupported float bit depth: {}", bits_per_sample));
        }
        Ok((
            sample_rate,
            channels,
            Box::new(move |input: &[u8]| {
                let samples = input.len() / 4;
                let mut output = Vec::with_capacity(samples * 2);
                for i in 0..samples {
                    let bytes = &input[i * 4..(i + 1) * 4];
                    let f = f32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
                    let s = (f.clamp(-1.0f32, 1.0f32) * 32767.0f32) as i16;
                    output.extend_from_slice(&s.to_le_bytes());
                }
                output
            }),
        ))
    } else {
        // PCM integer: support 8-bit, 16-bit, 24-bit, 32-bit.
        match bits_per_sample {
            8 => Ok((
                sample_rate,
                channels,
                Box::new(move |input: &[u8]| {
                    let mut output = Vec::with_capacity(input.len() * 2);
                    for &b in input {
                        let s = ((b as i16 - 128) * 256) as i16;
                        output.extend_from_slice(&s.to_le_bytes());
                    }
                    output
                }),
            )),
            16 => Ok((
                sample_rate,
                channels,
                Box::new(move |input: &[u8]| input.to_vec()),
            )),
            24 => Ok((
                sample_rate,
                channels,
                Box::new(move |input: &[u8]| {
                    let samples = input.len() / 3;
                    let mut output = Vec::with_capacity(samples * 2);
                    for i in 0..samples {
                        let bytes = &input[i * 3..(i + 1) * 3];
                        let signed =
                            (bytes[0] as i32 | ((bytes[1] as i32) << 8) | ((bytes[2] as i32) << 16))
                                << 8;
                        let s = (signed >> 16) as i16;
                        output.extend_from_slice(&s.to_le_bytes());
                    }
                    output
                }),
            )),
            32 => Ok((
                sample_rate,
                channels,
                Box::new(move |input: &[u8]| {
                    let samples = input.len() / 4;
                    let mut output = Vec::with_capacity(samples * 2);
                    for i in 0..samples {
                        let bytes = &input[i * 4..(i + 1) * 4];
                        let s = i32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as i16;
                        output.extend_from_slice(&s.to_le_bytes());
                    }
                    output
                }),
            )),
            _ => Err(format!("Unsupported PCM bit depth: {}", bits_per_sample)),
        }
    }
}

/// Captures the default render endpoint in loopback mode and sends i16 PCM chunks.
unsafe fn run_capture(
    sender: Sender<Vec<u8>>,
    running: Arc<AtomicBool>,
) -> Result<(), String> {
    CoInitializeEx(None, COINIT_MULTITHREADED)
        .ok()
        .map_err(|e| format!("CoInitializeEx failed: {:?}", e))?;

    let enumerator: IMMDeviceEnumerator =
        CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
            .map_err(|e| format!("CoCreateInstance(MMDeviceEnumerator) failed: {:?}", e))?;

    let device: IMMDevice = enumerator
        .GetDefaultAudioEndpoint(eRender, eConsole)
        .map_err(|e| format!("GetDefaultAudioEndpoint failed: {:?}", e))?;

    let audio_client: IAudioClient = device
        .Activate::<IAudioClient>(CLSCTX_ALL, None)
        .map_err(|e| format!("Activate(IAudioClient) failed: {:?}", e))?;

    let mix_format = audio_client
        .GetMixFormat()
        .map_err(|e| format!("GetMixFormat failed: {:?}", e))?;

    let (sample_rate, channels, converter) = make_format_converter(mix_format)?;

    // Prefer stereo output for the stream even if the device has a different channel count.
    let stream_channels = channels.min(TARGET_CHANNELS).max(1);

    let hns_buffer_duration = 10_000_000i64; // 1 second in hundred-nanoseconds
    audio_client
        .Initialize(
            AUDCLNT_SHAREMODE_SHARED,
            AUDCLNT_STREAMFLAGS_LOOPBACK,
            hns_buffer_duration,
            0,
            mix_format,
            None,
        )
        .map_err(|e| format!("IAudioClient::Initialize failed: {:?}", e))?;

    let capture_client: IAudioCaptureClient = audio_client
        .GetService()
        .map_err(|e| format!("GetService(IAudioCaptureClient) failed: {:?}", e))?;

    // Send header first so the stream starts immediately with valid WAV framing.
    let header = build_wav_header(sample_rate, stream_channels);
    if sender.send(header.to_vec()).is_err() {
        return Ok(());
    }

    audio_client
        .Start()
        .map_err(|e| format!("IAudioClient::Start failed: {:?}", e))?;

    let sleep_duration =
        Duration::from_millis((hns_buffer_duration as u64 / 10_000) / 2);

    while running.load(Ordering::Relaxed) {
        thread::sleep(sleep_duration);

        let mut packet_length = match capture_client.GetNextPacketSize() {
            Ok(n) => n,
            Err(e) => {
                // AUDCLNT_E_DEVICE_INVALIDATED means the default device changed.
                eprintln!("[audio_capture] GetNextPacketSize error: {:?}", e);
                break;
            }
        };

        while packet_length != 0 {
            let mut data: *mut u8 = std::ptr::null_mut();
            let mut frames_available = 0u32;
            let mut flags = 0u32;
            let mut device_position = 0u64;
            let mut qpc_position = 0u64;

            match capture_client.GetBuffer(
                &mut data,
                &mut frames_available,
                &mut flags,
                Some(&mut device_position),
                Some(&mut qpc_position),
            ) {
                Ok(_) => {
                    if !data.is_null() && frames_available > 0 {
                        let byte_count =
                            (frames_available as usize) * (channels as usize) * ((*mix_format).wBitsPerSample as usize / 8);
                        let slice = std::slice::from_raw_parts(data, byte_count);
                        let mut converted = converter(slice);

                        // Mono -> stereo duplication if needed.
                        if stream_channels == 2 && channels == 1 {
                            converted = converted
                                .chunks_exact(2)
                                .flat_map(|sample| [sample[0], sample[1], sample[0], sample[1]])
                                .collect();
                        }

                        if !converted.is_empty() && sender.send(converted).is_err() {
                            // Receiver gone: stop capture.
                            break;
                        }
                    }

                    if let Err(e) = capture_client.ReleaseBuffer(frames_available) {
                        eprintln!("[audio_capture] ReleaseBuffer error: {:?}", e);
                        break;
                    }
                }
                Err(e) => {
                    eprintln!("[audio_capture] GetBuffer error: {:?}", e);
                    break;
                }
            }

            packet_length = match capture_client.GetNextPacketSize() {
                Ok(n) => n,
                Err(e) => {
                    eprintln!("[audio_capture] GetNextPacketSize error: {:?}", e);
                    break;
                }
            };
        }
    }

    let _ = audio_client.Stop();
    Ok(())
}

/// Minimal HTTP server: only `GET /stream.wav` returns the live PCM stream.
fn run_server(listener: TcpListener, receiver: Receiver<Vec<u8>>, running: Arc<AtomicBool>) {
    while running.load(Ordering::Relaxed) {
        listener.set_nonblocking(true).ok();
        match listener.accept() {
            Ok((stream, _)) => {
                handle_client(stream, &receiver, &running);
            }
            Err(e) => {
                if e.kind() != std::io::ErrorKind::WouldBlock {
                    eprintln!("[audio_capture] accept error: {}", e);
                }
                thread::sleep(Duration::from_millis(50));
            }
        }
    }
}

fn handle_client(
    mut stream: TcpStream,
    receiver: &Receiver<Vec<u8>>,
    running: &Arc<AtomicBool>,
) {
    stream.set_read_timeout(Some(Duration::from_secs(3))).ok();
    stream.set_write_timeout(Some(Duration::from_secs(10))).ok();

    let mut buf = [0u8; 1024];
    let read_len = match stream.read(&mut buf) {
        Ok(n) => n,
        Err(_) => return,
    };

    if read_len == 0 || !buf[..read_len].windows(14).any(|w| w == b"GET /stream.wav") {
        let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n");
        return;
    }

    let response = b"HTTP/1.1 200 OK\r\nContent-Type: audio/wav\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n";
    if stream.write_all(response).is_err() {
        return;
    }
    if stream.flush().is_err() {
        return;
    }

    while running.load(Ordering::Relaxed) {
        match receiver.recv_timeout(Duration::from_millis(200)) {
            Ok(chunk) => {
                if stream.write_all(&chunk).is_err() {
                    break;
                }
                if stream.flush().is_err() {
                    break;
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
}

pub fn start() -> Result<String, String> {
    let mut state = CAPTURE_STATE.lock().map_err(|e| e.to_string())?;
    if state.running.load(Ordering::Relaxed) {
        return Ok(format!("http://{}:{}/stream.wav", STREAM_HOST, STREAM_PORT));
    }

    let listener = TcpListener::bind((STREAM_HOST, STREAM_PORT))
        .map_err(|e| format!("Failed to bind HTTP server: {}", e))?;

    let (sender, receiver): (Sender<Vec<u8>>, Receiver<Vec<u8>>) = mpsc::channel();
    let running_capture = Arc::new(AtomicBool::new(true));
    let running_server = running_capture.clone();

    let capture_thread = thread::spawn(move || {
        if let Err(e) = unsafe { run_capture(sender, running_capture) } {
            eprintln!("[audio_capture] capture thread error: {}", e);
        }
    });

    let server_thread = thread::spawn(move || {
        run_server(listener, receiver, running_server);
    });

    state.running.store(true, Ordering::SeqCst);
    state.capture_thread = Some(capture_thread);
    state.server_thread = Some(server_thread);

    Ok(format!("http://{}:{}/stream.wav", STREAM_HOST, STREAM_PORT))
}

pub fn stop() -> Result<(), String> {
    let mut state = CAPTURE_STATE.lock().map_err(|e| e.to_string())?;
    if !state.running.load(Ordering::Relaxed) {
        return Ok(());
    }

    state.running.store(false, Ordering::SeqCst);

    if let Some(handle) = state.capture_thread.take() {
        let _ = handle.join();
    }
    if let Some(handle) = state.server_thread.take() {
        let _ = handle.join();
    }

    state.reset();
    Ok(())
}
