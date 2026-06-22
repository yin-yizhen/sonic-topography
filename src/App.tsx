import { Canvas } from '@react-three/fiber';
import { UI } from './components/UI/UI';
import { MapScene } from './components/AudioVisualizer/MapScene';
import { Onboarding } from './components/UI/Onboarding';
import { useState } from 'react';
import { themes } from './lib/themes';

export default function App() {
  const [theme, setTheme] = useState('nocturnal');
  const t = themes[theme] || themes['nocturnal'];

  // Convert THREE.Color to css strings
  const bgDark = `#${t.uBaseColor1.getHexString()}`;

  return (
    <div className="relative w-screen h-screen overflow-hidden text-[#94a3b8] font-sans selection:bg-blue-500/30 transition-colors duration-1000" style={{ backgroundColor: bgDark }}>
      <UI theme={theme} onThemeChange={setTheme} />
      <Onboarding theme={theme} />
      <div className="absolute inset-0 z-0">
        <Canvas camera={{ position: [35, 25, 35], fov: 45 }}>
          <MapScene theme={theme} />
        </Canvas>
      </div>
    </div>
  );
}
