import { useState, useRef, useEffect } from 'react';
import { Mic, Send, Keyboard, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';

interface Message {
  role: 'user' | 'model';
  content: string;
}

export default function CustomerView() {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'model', content: 'Hi there! Welcome to NYC Coffee. What can I get started for you today?' }
  ]);
  const [inputMode, setInputMode] = useState<'voice' | 'text'>('text');
  const [textInput, setTextInput] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [receipt, setReceipt] = useState<any>(null);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, receipt]);

  const handleSendText = async () => {
    if (!textInput.trim() || isLoading) return;
    const userText = textInput.trim();
    setTextInput('');
    await processUserInput(userText);
  };

  const processUserInput = async (text: string) => {
    const newMessages = [...messages, { role: 'user' as const, content: text }];
    setMessages(newMessages);
    setIsLoading(true);

    try {
      // Format for Gemini API
      const apiMessages = newMessages.map(m => ({
        role: m.role,
        parts: [{ text: m.content }]
      }));

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiMessages })
      });

      const data = await response.json();
      
      if (data.text) {
        setMessages(prev => [...prev, { role: 'model', content: data.text }]);
        playTTS(data.text);
      }

      if (data.orderFinalized && data.orderData) {
        setReceipt(data.orderData);
      }
    } catch (error) {
      console.error('Chat error:', error);
      setMessages(prev => [...prev, { role: 'model', content: 'Sorry, I had trouble processing that. Could you repeat?' }]);
    } finally {
      setIsLoading(false);
    }
  };

  const playTTS = async (text: string) => {
    try {
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      
      if (response.ok) {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.play();
      } else {
        console.warn('TTS failed, possibly missing API key.');
      }
    } catch (error) {
      console.error('TTS error:', error);
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        await processAudioInput(audioBlob);
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (error) {
      console.error('Mic error:', error);
      alert('Could not access microphone.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const processAudioInput = async (blob: Blob) => {
    setIsLoading(true);
    const formData = new FormData();
    formData.append('audio', blob, 'recording.webm');

    try {
      const response = await fetch('/api/stt', {
        method: 'POST',
        body: formData
      });
      
      if (!response.ok) {
        throw new Error('STT failed');
      }

      const data = await response.json();
      if (data.text) {
        await processUserInput(data.text);
      }
    } catch (error) {
      console.error('STT error:', error);
      setMessages(prev => [...prev, { role: 'model', content: "Sorry, I couldn't hear that clearly. (Check if ELEVENLABS_API_KEY is set in .env)" }]);
      setIsLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto h-[80vh] flex flex-col bg-white rounded-3xl shadow-sm border border-stone-200 overflow-hidden relative">
      {/* Header */}
      <div className="bg-stone-900 text-white p-6 text-center">
        <h2 className="text-2xl font-serif font-bold tracking-tight">Order Here</h2>
        <p className="text-stone-400 text-sm mt-1">Speak naturally to our AI Cashier</p>
      </div>

      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-stone-50">
        {messages.map((msg, idx) => (
          <div key={idx} className={clsx("flex", msg.role === 'user' ? "justify-end" : "justify-start")}>
            <div className={clsx(
              "max-w-[80%] rounded-2xl px-5 py-3 text-base shadow-sm",
              msg.role === 'user' 
                ? "bg-stone-900 text-white rounded-br-sm" 
                : "bg-white border border-stone-200 text-stone-800 rounded-bl-sm"
            )}>
              {msg.content}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-white border border-stone-200 rounded-2xl rounded-bl-sm px-5 py-4 shadow-sm flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-stone-400" />
              <span className="text-stone-400 text-sm">Thinking...</span>
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Receipt Modal Overlay */}
      {receipt && (
        <div className="absolute inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-6 z-10">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="bg-stone-100 p-6 text-center border-b border-stone-200">
              <h3 className="font-serif text-xl font-bold">Receipt</h3>
              <p className="text-stone-500 text-sm">Order #{receipt.id}</p>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex justify-between text-sm font-medium border-b border-stone-100 pb-2">
                <span>Customer</span>
                <span>{receipt.customer_name}</span>
              </div>
              <div className="space-y-3">
                {receipt.items.map((item: any, i: number) => (
                  <div key={i} className="flex justify-between text-sm">
                    <div>
                      <span className="font-medium">{item.quantity}x {item.size} {item.temperature} {item.name}</span>
                      <div className="text-stone-500 text-xs mt-0.5">
                        {[item.milk_type, item.syrups, item.ice_level, item.sweetness_level].filter(Boolean).join(', ')}
                      </div>
                    </div>
                    <span>${item.price.toFixed(2)}</span>
                  </div>
                ))}
              </div>
              <div className="flex justify-between font-bold text-lg pt-4 border-t border-stone-200">
                <span>Total</span>
                <span>${receipt.total_price.toFixed(2)}</span>
              </div>
            </div>
            <div className="p-4 bg-stone-50 text-center">
              <button 
                onClick={() => { setReceipt(null); setMessages([{ role: 'model', content: 'Next customer please!' }]); }}
                className="text-sm font-medium text-stone-900 hover:underline"
              >
                Start New Order
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Input Area */}
      <div className="p-6 bg-white border-t border-stone-200">
        <div className="flex justify-between items-center mb-4">
          <button 
            onClick={() => setInputMode(prev => prev === 'voice' ? 'text' : 'voice')}
            className="text-xs font-medium text-stone-500 hover:text-stone-900 flex items-center gap-1.5 uppercase tracking-wider"
          >
            {inputMode === 'voice' ? <><Keyboard className="w-4 h-4" /> Use Keyboard</> : <><Mic className="w-4 h-4" /> Use Voice</>}
          </button>
        </div>

        {inputMode === 'voice' ? (
          <div className="flex justify-center py-4">
            <button
              onMouseDown={startRecording}
              onMouseUp={stopRecording}
              onTouchStart={startRecording}
              onTouchEnd={stopRecording}
              disabled={isLoading}
              className={clsx(
                "w-24 h-24 rounded-full flex items-center justify-center transition-all duration-200 shadow-lg",
                isRecording 
                  ? "bg-red-500 text-white scale-110 shadow-red-500/30" 
                  : "bg-stone-900 text-white hover:bg-stone-800",
                isLoading && "opacity-50 cursor-not-allowed"
              )}
            >
              <Mic className={clsx("w-10 h-10", isRecording && "animate-pulse")} />
            </button>
            <p className="absolute bottom-4 text-xs text-stone-400 font-medium">Hold to speak</p>
          </div>
        ) : (
          <div className="flex gap-3">
            <input
              type="text"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendText()}
              placeholder="Type your order..."
              disabled={isLoading}
              className="flex-1 bg-stone-100 border-transparent focus:bg-white focus:border-stone-900 focus:ring-0 rounded-xl px-4 py-3 text-sm transition-colors"
            />
            <button
              onClick={handleSendText}
              disabled={!textInput.trim() || isLoading}
              className="bg-stone-900 text-white px-5 rounded-xl hover:bg-stone-800 disabled:opacity-50 transition-colors flex items-center justify-center"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
