import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, Search, Music, Sparkles, ChevronRight, X, Volume2 } from 'lucide-react';
import { themes } from '../../lib/themes';

interface OnboardingProps {
  theme: string;
}

interface Step {
  id: number;
  icon: React.ReactNode;
  title: string;
  description: string;
  highlight?: string;
}

const ONBOARDING_KEY = 'sonic-topography-onboarding-complete';

const steps: Step[] = [
  {
    id: 1,
    icon: <Sparkles size={32} />,
    title: 'Welcome to Sonic Topography',
    description: 'Experience your music transformed into a living, breathing 3D landscape. Every beat, every frequency, every note shapes the world before you.',
    highlight: 'Audio-reactive 3D visualization'
  },
  {
    id: 2,
    icon: <Play size={32} />,
    title: 'Start with the Demo',
    description: 'Click the Demo button on the left sidebar to instantly experience the visualization with a built-in track. Watch the terrain pulse and flow with the music.',
    highlight: 'Left sidebar → Demo'
  },
  {
    id: 3,
    icon: <Music size={32} />,
    title: 'Play Your Own Music',
    description: 'Drag and drop any audio file (MP3, WAV, FLAC) directly onto the screen, or click Upload to browse your files. Add an .lrc file for synchronized lyrics.',
    highlight: 'Drag & drop audio files'
  },
  {
    id: 4,
    icon: <Search size={32} />,
    title: 'Search Netease Music',
    description: 'Open the Search panel to find and stream millions of songs. Results are automatically filtered to show only playable tracks, with lyrics included.',
    highlight: 'Left sidebar → Search'
  },
  {
    id: 5,
    icon: <Volume2 size={32} />,
    title: 'Interact with the World',
    description: 'Click anywhere on the terrain to create ripples. Hold longer for bigger waves. Drag to rotate the camera, scroll to zoom in and explore.',
    highlight: 'Click & hold to create ripples'
  }
];

export function Onboarding({ theme }: OnboardingProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [direction, setDirection] = useState(0);

  const t = themes[theme] || themes['nocturnal'];
  const accentHex = `#${t.uRippleColor.getHexString()}`;
  const warmHex = `#${t.uWarmCore.getHexString()}`;
  const baseBg = `#${t.uBaseColor1.getHexString()}`;
  const baseBg2 = `#${t.uBaseColor2.getHexString()}`;

  useEffect(() => {
    const hasSeen = localStorage.getItem(ONBOARDING_KEY);
    if (!hasSeen) {
      // Small delay to let the scene load first
      const timer = setTimeout(() => setIsVisible(true), 800);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleClose = () => {
    localStorage.setItem(ONBOARDING_KEY, 'true');
    setIsVisible(false);
  };

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setDirection(1);
      setCurrentStep(prev => prev + 1);
    } else {
      handleClose();
    }
  };

  const handlePrev = () => {
    if (currentStep > 0) {
      setDirection(-1);
      setCurrentStep(prev => prev - 1);
    }
  };

  const handleSkip = () => {
    handleClose();
  };

  const step = steps[currentStep];

  const slideVariants = {
    enter: (direction: number) => ({
      x: direction > 0 ? 50 : -50,
      opacity: 0,
      scale: 0.95
    }),
    center: {
      x: 0,
      opacity: 1,
      scale: 1
    },
    exit: (direction: number) => ({
      x: direction < 0 ? 50 : -50,
      opacity: 0,
      scale: 0.95
    })
  };

  if (!isVisible) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[200] flex items-center justify-center"
        style={{ 
          backgroundColor: 'rgba(0, 0, 0, 0.85)',
          backdropFilter: 'blur(12px)',
          fontFamily: "'Helvetica Neue', Arial, sans-serif"
        }}
      >
        {/* Ambient glow effects */}
        <div 
          className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full blur-3xl opacity-20"
          style={{ backgroundColor: accentHex }}
        />
        <div 
          className="absolute bottom-1/4 right-1/4 w-80 h-80 rounded-full blur-3xl opacity-15"
          style={{ backgroundColor: warmHex }}
        />

        {/* Main card */}
        <motion.div
          initial={{ scale: 0.9, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.9, opacity: 0, y: 20 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="relative w-[480px] max-w-[90vw] overflow-hidden"
          style={{
            background: `linear-gradient(135deg, ${baseBg} 0%, ${baseBg2} 100%)`,
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '16px',
            boxShadow: `0 0 60px ${accentHex}20, 0 25px 50px rgba(0, 0, 0, 0.5)`
          }}
        >
          {/* Top accent line */}
          <motion.div 
            className="absolute top-0 left-0 right-0 h-[2px]"
            style={{ 
              background: `linear-gradient(90deg, transparent, ${accentHex}, ${warmHex}, ${accentHex}, transparent)`,
              backgroundSize: '200% 100%'
            }}
            animate={{ backgroundPosition: ['0% 0%', '200% 0%'] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
          />

          {/* Close button */}
          <button
            onClick={handleSkip}
            className="absolute top-4 right-4 text-white/40 hover:text-white transition-colors z-10"
            title="Skip tutorial"
          >
            <X size={20} />
          </button>

          {/* Step counter */}
          <div className="absolute top-5 left-6 text-[10px] uppercase tracking-[0.2em] text-white/30 font-medium">
            {currentStep + 1} / {steps.length}
          </div>

          {/* Content area */}
          <div className="relative h-[380px] overflow-hidden">
            <AnimatePresence mode="wait" custom={direction}>
              <motion.div
                key={step.id}
                custom={direction}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.3, ease: 'easeInOut' }}
                className="absolute inset-0 flex flex-col items-center justify-center px-10 text-center"
              >
                {/* Icon */}
                <motion.div
                  initial={{ scale: 0, rotate: -10 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ delay: 0.1, type: 'spring', damping: 15 }}
                  className="mb-8 p-6 rounded-2xl"
                  style={{
                    background: `linear-gradient(135deg, ${accentHex}15, ${warmHex}15)`,
                    border: `1px solid ${accentHex}30`,
                    boxShadow: `0 0 40px ${accentHex}20`
                  }}
                >
                  <span style={{ color: accentHex }}>{step.icon}</span>
                </motion.div>

                {/* Title */}
                <motion.h2
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className="text-2xl font-light text-white mb-4 tracking-wide"
                >
                  {step.title}
                </motion.h2>

                {/* Description */}
                <motion.p
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                  className="text-sm text-white/50 leading-relaxed mb-6 max-w-[360px]"
                >
                  {step.description}
                </motion.p>

                {/* Highlight pill */}
                {step.highlight && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.4 }}
                    className="px-4 py-2 rounded-full text-[11px] uppercase tracking-[0.15em] font-medium"
                    style={{
                      backgroundColor: `${accentHex}15`,
                      color: accentHex,
                      border: `1px solid ${accentHex}30`
                    }}
                  >
                    {step.highlight}
                  </motion.div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Progress dots */}
          <div className="flex justify-center gap-2 mb-6">
            {steps.map((_, index) => (
              <motion.div
                key={index}
                className="h-1.5 rounded-full cursor-pointer"
                animate={{
                  width: index === currentStep ? 24 : 8,
                  backgroundColor: index === currentStep ? accentHex : 'rgba(255, 255, 255, 0.15)'
                }}
                transition={{ duration: 0.3 }}
                onClick={() => {
                  setDirection(index > currentStep ? 1 : -1);
                  setCurrentStep(index);
                }}
              />
            ))}
          </div>

          {/* Bottom controls */}
          <div className="flex items-center justify-between px-6 pb-6">
            <button
              onClick={handleSkip}
              className="text-[11px] uppercase tracking-[0.15em] text-white/30 hover:text-white/60 transition-colors"
            >
              Skip all
            </button>

            <div className="flex gap-3">
              {currentStep > 0 && (
                <motion.button
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  onClick={handlePrev}
                  className="px-5 py-2.5 rounded-lg text-[11px] uppercase tracking-[0.15em] text-white/50 hover:text-white transition-colors border border-white/10 hover:border-white/20"
                >
                  Back
                </motion.button>
              )}
              
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={handleNext}
                className="flex items-center gap-2 px-6 py-2.5 rounded-lg text-[11px] uppercase tracking-[0.15em] font-medium text-black transition-all"
                style={{ backgroundColor: accentHex }}
              >
                {currentStep === steps.length - 1 ? 'Get Started' : 'Next'}
                <ChevronRight size={14} />
              </motion.button>
            </div>
          </div>

          {/* Bottom glow */}
          <div 
            className="absolute bottom-0 left-1/2 -translate-x-1/2 w-2/3 h-20 blur-2xl opacity-30"
            style={{ backgroundColor: accentHex }}
          />
        </motion.div>

        {/* Brand watermark */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="absolute bottom-8 text-[10px] uppercase tracking-[0.3em] text-white/20"
        >
          Sonic Topography
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
