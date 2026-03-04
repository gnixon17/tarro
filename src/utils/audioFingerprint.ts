export interface FingerprintConfig {
  fftSize: number;
  smoothingTimeConstant: number;
  minVolume: number;
}

const defaultConfig: FingerprintConfig = {
  fftSize: 256,
  smoothingTimeConstant: 0.85,
  minVolume: 10
};

export class AudioFingerprinter {
  private audioContext: AudioContext;
  private analyser: AnalyserNode;
  private microphone: MediaStreamAudioSourceNode | null = null;
  private dataArray: Uint8Array;
  private isRecording = false;
  private accumulatedSpectra: number[][] = [];
  private config: FingerprintConfig;

  constructor() {
    this.config = { ...defaultConfig };
    try {
      const saved = localStorage.getItem('voice_config');
      if (saved) {
        this.config = { ...this.config, ...JSON.parse(saved) };
      }
    } catch (e) {
      console.error("Failed to load voice config", e);
    }

    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = this.config.fftSize;
    this.analyser.smoothingTimeConstant = this.config.smoothingTimeConstant;
    this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
  }

  async start() {
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.microphone = this.audioContext.createMediaStreamSource(stream);
      this.microphone.connect(this.analyser);
      this.isRecording = true;
      this.accumulatedSpectra = [];
      this.collectData();
    } catch (err) {
      console.error('Error accessing microphone:', err);
      throw err; // Re-throw so UI can handle it
    }
  }

  stop() {
    this.isRecording = false;
    if (this.microphone) {
      this.microphone.disconnect();
      this.microphone.mediaStream.getTracks().forEach(track => track.stop());
      this.microphone = null;
    }
  }

  private collectData = () => {
    if (!this.isRecording) return;
    
    this.analyser.getByteFrequencyData(this.dataArray);
    
    // Only accumulate if there is significant audio (simple VAD)
    const volume = this.dataArray.reduce((a, b) => a + b, 0) / this.dataArray.length;
    if (volume > this.config.minVolume) { // Threshold for silence
      this.accumulatedSpectra.push(Array.from(this.dataArray));
    }

    requestAnimationFrame(this.collectData);
  };

  getFingerprint(): number[] | null {
    if (this.accumulatedSpectra.length === 0) return null;

    // Average the accumulated spectra to get a single vector
    const bins = this.accumulatedSpectra[0].length;
    const averaged = new Array(bins).fill(0);

    for (const spectrum of this.accumulatedSpectra) {
      for (let i = 0; i < bins; i++) {
        averaged[i] += spectrum[i];
      }
    }

    return averaged.map(val => Math.round(val / this.accumulatedSpectra.length));
  }
}
