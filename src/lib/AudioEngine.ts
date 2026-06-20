import { AudioData } from '../types';
import {
  startSystemAudioCapture,
  stopSystemAudioCapture,
} from './tauri';

export type TriggerPreset = 'Auto Beat' | 'Advanced';

export class TriggerConfig {
  public enabled: boolean = false;
  public mode: TriggerPreset = 'Auto Beat';
  
  // Advanced parameters
  public freqIndex: number = -1;
  public threshold: number = 0.5;
  
  // Auto Beat parameters
  public sensitivity: number = 0.15;
  public cooldown: number = 60;
  public bandStart: number = 0;
  public bandEnd: number = 16;
  public pulseStrength: number = 0.2;

  // Internal evaluation state
  public currentCooldown: number = 0;
  public beatHold: number = 0;
  public lastEvalEnergy: number = 0;
  public lastEvalThresh: number = 0;
  
  public fluxHistory: number[] = new Array(40).fill(0);
  public fluxHistoryIndex: number = 0;
  public smoothedFlux: number = 0;
  public prevSmoothedFlux: number = 0;

  constructor(public action: 'Pulse' | 'Meteor') {
      this.enabled = true; // Both Pulse and Meteor enabled by default
      this.mode = 'Auto Beat';
      this.bandStart = 0;
      this.bandEnd = 16;
      if (action === 'Meteor') {
          // meteor default params matching user request
          this.bandStart = 159;
          this.bandEnd = 174;
          this.sensitivity = 0.45; 
          this.cooldown = 241; 
          this.pulseStrength = 0.50;
      }
  }

  public getTriggerRange(): [number, number] {
    if (this.mode === 'Auto Beat') return [this.bandStart, this.bandEnd];
    const c = this.freqIndex >= 0 ? this.freqIndex : Math.floor(0.2 * 512);
    return [Math.max(0, c - 2), Math.min(511, c + 2)];
  }
}


export class AudioEngine {
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private fadeNode: GainNode | null = null;
  private captureStream: MediaStream | null = null;
  private captureSource: MediaStreamAudioSourceNode | null = null;
  public audioElement: HTMLAudioElement;

  private dataArray: Uint8Array = new Uint8Array(0);
  
  public isPlaying: boolean = false;
  public isCapturing: boolean = false;
  private pauseTimeout: ReturnType<typeof setTimeout> | null = null;
  private fadeTime = 0.5; // seconds
  private visualReleaseUntil = 0;
  private visualReleaseTime = 1.6; // seconds
  
  private beatThreshold = 0.4;
  private beatDecay = 0.95;
  private beatHoldTime = 20;
  private beatHold = 0;
  
  // Legacy fields removed

  public onBeat?: (strength: number, type: 'kick' | 'snare') => void;

  constructor() {
    this.audioElement = new Audio();
    this.audioElement.crossOrigin = 'anonymous';
    
    // Attempt to handle ended events
    this.audioElement.addEventListener('ended', () => {
      this.isPlaying = false;
    });

    this.audioElement.addEventListener('play', () => {
      this.isPlaying = true;
    });
    
    this.audioElement.addEventListener('pause', () => {
      this.isPlaying = false;
    });
  }

  public init() {
    if (this.audioCtx) return;
    
    // @ts-ignore
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    this.audioCtx = new AudioContext();
    
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 1024; // 512 bins
    this.analyser.smoothingTimeConstant = 0.8;
    
    this.fadeNode = this.audioCtx.createGain();
    this.fadeNode.gain.value = 0.001; // Start muted
    
    this.source = this.audioCtx.createMediaElementSource(this.audioElement);
    this.source.connect(this.fadeNode);
    this.fadeNode.connect(this.audioCtx.destination);
    // Also feed to analyser
    this.fadeNode.connect(this.analyser);
    
    this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
  }

  private isTauri(): boolean {
    if (typeof window === 'undefined') return false;
    return !!(window.__TAURI_INTERNALS__ || window.__TAURI__);
  }

  private async tryGetLoopbackStream(): Promise<MediaStream | null> {
    // On Windows, "Stereo Mix" / "立体声混音" is a loopback input device that captures
    // everything playing through the default output. Try to use it automatically
    // before falling back to the desktop media picker.
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      const devices = await navigator.mediaDevices.enumerateDevices();
      const loopback = devices.find(
        d => d.kind === 'audioinput' &&
          /(stereo mix|立体声混音|loopback|what u hear|wave out|主声音捕获)/i.test(d.label)
      );
      if (loopback && loopback.deviceId) {
        return navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: { exact: loopback.deviceId },
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });
      }
    } catch (e) {
      console.warn('Auto loopback capture failed:', e);
    }
    return null;
  }

  public async startCapture() {
    await this.init();
    if (this.audioCtx?.state === 'suspended') {
      this.audioCtx.resume();
    }

    // In Tauri on Windows, ask the Rust side to capture the default render
    // endpoint and expose it as a local HTTP WAV stream. The existing audio
    // element is already wired to the analyser, so visualization continues
    // to work with almost no frontend changes.
    if (this.isTauri()) {
      try {
        if (this.pauseTimeout) {
          clearTimeout(this.pauseTimeout);
          this.pauseTimeout = null;
        }

        this.audioElement.pause();
        this.beginVisualRelease();

        const { url } = await startSystemAudioCapture();

        this.audioElement.src = url;
        this.audioElement.load();

        if (this.fadeNode && this.audioCtx) {
          this.fadeNode.gain.cancelScheduledValues(this.audioCtx.currentTime);
          this.fadeNode.gain.setValueAtTime(0.001, this.audioCtx.currentTime);
          this.fadeNode.gain.linearRampToValueAtTime(
            1.0,
            this.audioCtx.currentTime + this.fadeTime
          );
        }

        await this.audioElement.play();

        this.isCapturing = true;
        this.isPlaying = true;

        this.audioElement.addEventListener('ended', () => {
          this.isCapturing = false;
          this.isPlaying = false;
        });
      } catch (e) {
        console.warn('Tauri system audio capture failed:', e);
        this.isCapturing = false;
        this.isPlaying = false;
      }
      return;
    }

    this.pause(); // stop file playback if any

    try {
      // 1. Try Stereo Mix / loopback input device.
      this.captureStream = await this.tryGetLoopbackStream();

      // 2. Last resort: ask the user via the desktop media picker.
      if (!this.captureStream) {
        try {
          this.captureStream = await navigator.mediaDevices.getDisplayMedia({
            audio: {
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
            },
            video: false as unknown as MediaTrackConstraints,
          });
        } catch {
          this.captureStream = await navigator.mediaDevices.getDisplayMedia({
            audio: {
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
            },
            video: true,
          });
        }
      }

      if (!this.audioCtx || !this.analyser || !this.captureStream) return;

      if (this.captureSource) {
        this.captureSource.disconnect();
      }

      // Stop any video tracks to save resources; keep audio tracks.
      this.captureStream.getVideoTracks().forEach(track => track.stop());

      this.captureSource = this.audioCtx.createMediaStreamSource(this.captureStream);
      // Connect directly to analyser, NOT to destination (avoids feedback)
      this.captureSource.connect(this.analyser);

      this.isCapturing = true;
      this.isPlaying = true;

      this.captureStream.getAudioTracks()[0]?.addEventListener('ended', () => {
         this.stopCapture();
      });

    } catch (e) {
      console.warn('System audio capture canceled or denied:', e);
      this.isCapturing = false;
      this.isPlaying = false;
    }
  }

  public stopCapture() {
    this.beginVisualRelease();
    if (this.isTauri()) {
      stopSystemAudioCapture().catch((e) => {
        console.warn('Failed to stop Tauri system audio capture:', e);
      });
      this.audioElement.pause();
    }
    if (this.captureStream) {
      this.captureStream.getTracks().forEach(track => track.stop());
      this.captureStream = null;
    }
    if (this.captureSource) {
      this.captureSource.disconnect();
      this.captureSource = null;
    }
    this.isCapturing = false;
    this.isPlaying = false;
  }

  public loadFile(file: File) {
    this.beginVisualRelease();
    this.stopCapture();
    const url = URL.createObjectURL(file);
    this.audioElement.src = url;
    this.audioElement.load();
  }

  public loadUrl(url: string) {
    this.beginVisualRelease();
    this.stopCapture();
    this.audioElement.src = url;
    this.audioElement.load();
  }

  public play() {
    if (!this.audioElement.src) return;
    if (this.audioCtx?.state === 'suspended') {
      this.audioCtx.resume();
    }
    
    if (this.pauseTimeout) {
      clearTimeout(this.pauseTimeout);
      this.pauseTimeout = null;
    }

    if (this.fadeNode && this.audioCtx) {
      this.fadeNode.gain.cancelScheduledValues(this.audioCtx.currentTime);
      this.fadeNode.gain.setValueAtTime(this.fadeNode.gain.value, this.audioCtx.currentTime);
      this.fadeNode.gain.linearRampToValueAtTime(1.0, this.audioCtx.currentTime + this.fadeTime);
    }
    
    this.audioElement.play().catch(e => console.warn('Audio play error:', e));
  }

  public pause() {
    this.beginVisualRelease();
    if (this.fadeNode && this.audioCtx) {
       this.fadeNode.gain.cancelScheduledValues(this.audioCtx.currentTime);
       this.fadeNode.gain.setValueAtTime(this.fadeNode.gain.value, this.audioCtx.currentTime);
       this.fadeNode.gain.linearRampToValueAtTime(0.001, this.audioCtx.currentTime + this.fadeTime);
       
       this.pauseTimeout = setTimeout(() => {
          this.audioElement.pause();
       }, this.fadeTime * 1000);
    } else {
       this.audioElement.pause();
    }
  }
  
  public togglePlay() {
    if (this.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  }

  private beginVisualRelease(seconds = this.visualReleaseTime) {
    this.visualReleaseUntil = performance.now() + seconds * 1000;
  }

  private prevData: number[] = new Array(512).fill(0);
  private prevBrightness: number = 0;

  private smoothedData: AudioData = {
    bass: 0, mid: 0, treble: 0, energy: 0,
    subBass: 0, lowMid: 0, highMid: 0, presence: 0, brilliance: 0, air: 0,
    warmth: 0, brightness: 0, sharpness: 0, smoothness: 0, density: 0, spectralCentroid: 0
  };

  public pulseTrigger = new TriggerConfig('Pulse');
  public meteorTrigger = new TriggerConfig('Meteor');
  
  public onFreqTrigger?: (strength: number, type: 'Kick' | 'Snare' | 'Advanced', action: 'Pulse' | 'Meteor') => void;

  private evaluateTrigger(config: TriggerConfig, fluxScore: number) {
      if (!config.enabled || !this.isPlaying) return;
      
      const binCount = this.dataArray.length;
      let eVal = 0;
      let triggered = false;
      const [startBin, endBin] = config.getTriggerRange();

      if (config.mode === 'Advanced') {
          if (config.freqIndex >= 0 && config.freqIndex < binCount) {
             let sum = 0;
             let count = 0;
             for (let k = startBin; k <= endBin; k++) {
                sum += this.dataArray[k] / 255.0;
                count++;
             }
             eVal = sum / count;
             
             config.lastEvalThresh = config.threshold;
             if (config.currentCooldown <= 0 && eVal > config.threshold) {
                 triggered = true;
             }
          }
          config.lastEvalEnergy = eVal;
          if (triggered) {
              if (this.onFreqTrigger) this.onFreqTrigger(eVal, 'Advanced', config.action);
              config.currentCooldown = 60; // 1s
          }
      }

      if (config.currentCooldown > 0) config.currentCooldown--;

      // Auto Beat Evaluation
      if (config.mode === 'Auto Beat') {
         config.smoothedFlux += (fluxScore - config.smoothedFlux) * 0.4;
         config.fluxHistory[config.fluxHistoryIndex] = config.smoothedFlux;
         config.fluxHistoryIndex = (config.fluxHistoryIndex + 1) % config.fluxHistory.length;

         let avgFlux = 0, fluxVariance = 0;
         for (let i = 0; i < config.fluxHistory.length; i++) avgFlux += config.fluxHistory[i];
         avgFlux /= config.fluxHistory.length;

         for (let i = 0; i < config.fluxHistory.length; i++) {
             fluxVariance += Math.pow(config.fluxHistory[i] - avgFlux, 2);
         }
         fluxVariance /= config.fluxHistory.length;
         const fluxStdDev = Math.sqrt(fluxVariance);

         const thresholdMultiplier = Math.max(0.1, 5.0 - config.sensitivity * 4.0);
         const adaptiveThreshold = Math.max(0.05, avgFlux + fluxStdDev * thresholdMultiplier);

         const isPeak = config.prevSmoothedFlux > adaptiveThreshold && config.prevSmoothedFlux >= config.smoothedFlux;

         if (config.beatHold > 0) {
            config.beatHold--;
         } else if (isPeak && config.prevSmoothedFlux - config.smoothedFlux > 0.0001) {
            if (this.onFreqTrigger) this.onFreqTrigger(config.prevSmoothedFlux * 3.0 * config.pulseStrength, 'Kick', config.action);
            config.beatHold = config.cooldown;
         }

         config.lastEvalEnergy = config.smoothedFlux * 2.0;
         config.lastEvalThresh = adaptiveThreshold * 2.0;
         config.prevSmoothedFlux = config.smoothedFlux;
      }
  }

  private lastAnalysisTime = 0;
  private cachedAudioData: AudioData | null = null;

  public getRawFrequencyData(): Uint8Array {
    // Ensure frequency data is current for this animation frame.
    if (performance.now() - this.lastAnalysisTime >= 1.0) {
      this.analyzeFrame();
    }
    return this.dataArray;
  }

  public getAudioData(): AudioData {
    if (!this.analyser) {
      return { ...this.smoothedData };
    }

    const now = performance.now();
    if (now - this.lastAnalysisTime < 1.0 && this.cachedAudioData) {
      return { ...this.cachedAudioData };
    }

    return this.analyzeFrame();
  }

  public isVisualReleasing(): boolean {
    return performance.now() < this.visualReleaseUntil;
  }

  private analyzeFrame(): AudioData {
    if (!this.analyser) {
      return { ...this.smoothedData };
    }

    const isVisualReleasing = performance.now() < this.visualReleaseUntil;
    let energySum = 0;
    let centroidNum = 0;
    let centroidDen = 0;

    let subBassSum = 0, bassSum = 0, lowMidSum = 0, midSum = 0;
    let highMidSum = 0, presenceSum = 0, brillianceSum = 0, airSum = 0;
    let jumpVolatilitySum = 0;
    let fluxScore = 0;

    const binCount = this.dataArray.length; // 512

    if (this.isPlaying) {
      this.analyser.getByteFrequencyData(this.dataArray);

      let fluxPulse = 0;
      let fluxMeteor = 0;

      for (let i = 0; i < binCount; i++) {
          const val = this.dataArray[i] / 255.0; // normalize 0-1
          energySum += val;
          
          centroidNum += i * val;
          centroidDen += val;

          const prevVal = this.prevData[i] || 0;
          jumpVolatilitySum += Math.abs(val - prevVal);
          
          // Flux for pulse
          if (i >= this.pulseTrigger.bandStart && i <= this.pulseTrigger.bandEnd) {
             const diff = val - prevVal;
             if (diff > 0) fluxPulse += diff;
          }

          // Flux for meteor
          if (i >= this.meteorTrigger.bandStart && i <= this.meteorTrigger.bandEnd) {
             const diff = val - prevVal;
             if (diff > 0) fluxMeteor += diff;
          }

          this.prevData[i] = val;

          if (i <= 1) subBassSum += val;
          else if (i <= 3) bassSum += val;
          else if (i <= 7) lowMidSum += val;
          else if (i <= 18) midSum += val;
          else if (i <= 46) highMidSum += val;
          else if (i <= 93) presenceSum += val;
          else if (i <= 186) brillianceSum += val;
          else if (i <= 372) airSum += val;
      }
      
      this.evaluateTrigger(this.pulseTrigger, fluxPulse);
      this.evaluateTrigger(this.meteorTrigger, fluxMeteor);
    } else {
      // When playback stops or switches, decay raw and smoothed values instead of snapping to zero.
      for (let i = 0; i < binCount; i++) {
          this.dataArray[i] = isVisualReleasing ? Math.floor(this.dataArray[i] * 0.94) : 0;
          this.prevData[i] = 0;
      }
    }

    const energy = energySum / binCount;
    
    // Average amplitudes per band
    const subBass = subBassSum / 2;
    const bass = bassSum / 2;
    const lowMid = lowMidSum / 4;
    const mid = midSum / 11;
    const highMid = highMidSum / 28;
    const presence = presenceSum / 47;
    const brilliance = brillianceSum / 93;
    const air = airSum / 186;

    // Precise band isolation for better beat detection
    const kickEnergy = (subBassSum + bassSum) / 4; 
    const snareEnergy = (midSum + highMidSum) / 39; 

    // Legacy mapping for compatibility
    const oldBass = (subBassSum + bassSum + lowMidSum) / 8;
    const oldMid = (midSum + highMidSum) / 39;
    const oldTreble = (presenceSum + brillianceSum + airSum) / 326;

    // Timbral Metrics
    const warmth = energySum > 0 ? (subBassSum + bassSum + lowMidSum + midSum) / energySum : 0;
    const brightness = energySum > 0 ? (presenceSum + brillianceSum + airSum) / energySum : 0;
    
    const sharpness = Math.max(0, brightness - this.prevBrightness) * 10;
    this.prevBrightness = brightness;

    const smoothnessVal = Math.max(0, 1.0 - (jumpVolatilitySum / binCount) * 2.0);
    
    const activeThreshold = energy * 1.5;
    let activeBands = 0;
    if (subBass > activeThreshold) activeBands++;
    if (bass > activeThreshold) activeBands++;
    if (lowMid > activeThreshold) activeBands++;
    if (mid > activeThreshold) activeBands++;
    if (highMid > activeThreshold) activeBands++;
    if (presence > activeThreshold) activeBands++;
    if (brilliance > activeThreshold) activeBands++;
    if (air > activeThreshold) activeBands++;
    const density = activeBands / 8;

    const spectralCentroid = centroidDen > 0 ? centroidNum / centroidDen : 0;

    // Apply Exponential Smoothing to prevent sudden jumping/explosions
    const hasIncomingAudio = this.isPlaying && energySum > 0;
    const dt = hasIncomingAudio ? 0.15 : (isVisualReleasing ? 0.035 : 0.08); // smoothing factor (0 = stuck, 1 = instant jump)
    
    this.smoothedData.bass += (oldBass - this.smoothedData.bass) * dt;
    this.smoothedData.mid += (oldMid - this.smoothedData.mid) * dt;
    this.smoothedData.treble += (oldTreble - this.smoothedData.treble) * dt;
    this.smoothedData.energy += (energy - this.smoothedData.energy) * dt;
    
    this.smoothedData.subBass += (subBass - this.smoothedData.subBass) * dt;
    this.smoothedData.lowMid += (lowMid - this.smoothedData.lowMid) * dt;
    this.smoothedData.highMid += (highMid - this.smoothedData.highMid) * dt;
    this.smoothedData.presence += (presence - this.smoothedData.presence) * dt;
    this.smoothedData.brilliance += (brilliance - this.smoothedData.brilliance) * dt;
    this.smoothedData.air += (air - this.smoothedData.air) * dt;
    
    this.smoothedData.warmth += (warmth - this.smoothedData.warmth) * dt;
    this.smoothedData.brightness += (brightness - this.smoothedData.brightness) * dt;
    this.smoothedData.sharpness += (sharpness - this.smoothedData.sharpness) * dt;
    this.smoothedData.smoothness += (smoothnessVal - this.smoothedData.smoothness) * dt;
    this.smoothedData.density += (density - this.smoothedData.density) * dt;
    this.smoothedData.spectralCentroid += (spectralCentroid - this.smoothedData.spectralCentroid) * dt;

    this.lastAnalysisTime = performance.now();
    this.cachedAudioData = this.smoothedData;

    return { ...this.smoothedData };
  }
}

export const engine = new AudioEngine();
