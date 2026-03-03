import { useState, useRef, useEffect } from 'react';
import { Mic, MicOff, Send, Keyboard, Coffee, UserPlus, Fingerprint } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { processChatTurn, Message } from '../services/gemini';
import { AudioFingerprinter } from '../utils/audioFingerprint';

export default function Customer() {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: "Hi! Welcome to NYC Coffee. What can I get started for you today?" }
  ]);
  const [input, setInput] = useState('');
  const [isVoiceMode, setIsVoiceMode] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [receipt, setReceipt] = useState<any>(null);
  const [waitTime, setWaitTime] = useState<number | null>(null);
  const [identifiedUser, setIdentifiedUser] = useState<any>(null);
  const [isEnrolling, setIsEnrolling] = useState(false);
  const [enrollmentStatus, setEnrollmentStatus] = useState<string>('');
  const [identificationStatus, setIdentificationStatus] = useState<string>('');
  
  const chatEndRef = useRef<HTMLDivElement>(null);
  const fingerprinterRef = useRef<AudioFingerprinter | null>(null);

  const isEnrollingRef = useRef(false);

  // Sync ref with state
  useEffect(() => {
    isEnrollingRef.current = isEnrolling;
  }, [isEnrolling]);

  // Initialize Audio Fingerprinter
  useEffect(() => {
    fingerprinterRef.current = new AudioFingerprinter();
    return () => {
      fingerprinterRef.current?.stop();
    };
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Handle TTS
  const playTTS = async (text: string) => {
    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      
      if (res.ok) {
        const contentType = res.headers.get('Content-Type');
        if (contentType && contentType.includes('audio')) {
          const blob = await res.blob();
          const audio = new Audio(URL.createObjectURL(blob));
          audio.play();
        } else {
          // Mock fallback: use browser TTS
          const utterance = new SpeechSynthesisUtterance(text);
          window.speechSynthesis.speak(utterance);
        }
      }
    } catch (e) {
      console.error("TTS Error", e);
    }
  };

  const handleSend = async (text: string) => {
    if (!text.trim()) return;
    if (isEnrollingRef.current) return; // Don't process chat if enrolling
    
    const newMessages = [...messages, { role: 'user' as const, content: text }];
    setMessages(newMessages);
    setInput('');
    setIsLoading(true);

    try {
      // Pass identified user context if available
      const context = identifiedUser 
        ? `[SYSTEM: The user has been identified by voice as ${identifiedUser.name}. Their regular order is: ${JSON.stringify(identifiedUser.regular_order)}.]`
        : undefined;

      const data = await processChatTurn(newMessages, undefined, context);
      
      if (data.text) {
        setMessages(prev => [...prev, { role: 'assistant', content: data.text }]);
        if (isVoiceMode) playTTS(data.text);
      }

      if (data.functionCall && data.functionCall.name === 'finalize_order') {
        const orderArgs = data.functionCall.args;
        setReceipt(orderArgs);
        
        // Save to DB
        await fetch('/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(orderArgs)
        });

        // Fetch Wait Time
        const queueRes = await fetch('/api/queue-status');
        if (queueRes.ok) {
          const queueData = await queueRes.json();
          setWaitTime(queueData.estimatedWaitTime);
        }
      }
    } catch (e: any) {
      console.error(e);
      const errorMessage = e.message?.includes('API key not valid') || e.message?.includes('missing')
        ? "API key is missing or invalid. Please configure a valid Gemini API key in the AI Studio Secrets panel."
        : "Sorry, I'm having trouble connecting to the kitchen.";
      setMessages(prev => [...prev, { role: 'assistant', content: errorMessage }]);
    } finally {
      setIsLoading(false);
    }
  };

  const processAudioAndStop = async () => {
    setIsRecording(false);
    fingerprinterRef.current?.stop();

    // Enrollment Logic
    if (isEnrollingRef.current && receipt) {
      const fingerprint = fingerprinterRef.current?.getFingerprint();
      if (fingerprint) {
        await saveRegular(fingerprint);
      } else {
        setEnrollmentStatus("Failed to capture voice. Try again.");
        setTimeout(() => setEnrollmentStatus(''), 3000);
      }
      setIsEnrolling(false);
      return;
    }

    // Identification Logic
    const fingerprint = fingerprinterRef.current?.getFingerprint();
    if (fingerprint && !identifiedUser) {
      identifyUser(fingerprint);
    }
  };

  const toggleRecording = async () => {
    if (isRecording) {
      await processAudioAndStop();
    } else {
      setIsRecording(true);
      try {
        await fingerprinterRef.current?.start();
      } catch (e) {
        alert("Could not access microphone. Please check your browser permissions.");
        setIsRecording(false);
        return;
      }
      
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = false;
        
        recognition.onresult = (event: any) => {
          const transcript = event.results[0][0].transcript;
          handleSend(transcript);
        };
        
        recognition.onend = () => {
          // If enrolling, we treat the end of speech as the trigger to save
          if (isEnrollingRef.current) {
             processAudioAndStop(); 
          } else {
             setIsRecording(false);
          }
        };
        recognition.start();
      } else {
        alert("Speech recognition not supported in this browser. Please use text mode.");
        setIsRecording(false);
        setIsVoiceMode(false);
      }
    }
  };

  const identifyUser = async (fingerprint: number[]) => {
    try {
      setIdentificationStatus("Identifying...");
      const res = await fetch('/api/identify-voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fingerprint })
      });
      const data = await res.json();
      if (data.match) {
        setIdentifiedUser(data.customer);
        setIdentificationStatus(`Welcome back, ${data.customer.name}!`);
        setTimeout(() => setIdentificationStatus(''), 3000);
      } else {
        setIdentificationStatus('');
      }
    } catch (e) {
      console.error("Identification failed", e);
      setIdentificationStatus('');
    }
  };

  const saveRegular = async (fingerprint: number[]) => {
    try {
      setEnrollmentStatus("Saving profile...");
      await fetch('/api/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: receipt.customer_name,
          voice_fingerprint: fingerprint,
          regular_order: receipt.items
        })
      });
      setEnrollmentStatus("Profile saved! Next time, just say 'Give me the regular'.");
      
      // Immediately identify the user after saving
      setIdentifiedUser({
        name: receipt.customer_name,
        regular_order: receipt.items
      });
    } catch (e) {
      setEnrollmentStatus("Error saving profile.");
    }
  };

  const startEnrollment = () => {
    setIsEnrolling(true);
    setEnrollmentStatus("Please say: 'My name is " + receipt.customer_name + " and this is my regular order.'");
    toggleRecording(); // Start recording immediately
  };

  return (
    <div className="max-w-2xl mx-auto h-[80vh] flex flex-col bg-white rounded-2xl shadow-sm border border-stone-200 overflow-hidden relative">
      <div className="bg-stone-900 text-white p-4 text-center font-medium tracking-wide flex items-center justify-center gap-2 relative">
        <Coffee className="w-5 h-5" />
        NYC Coffee Kiosk
        {identifiedUser && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            className="absolute right-4 flex items-center gap-1 text-xs bg-emerald-500/20 text-emerald-300 px-2 py-1 rounded-full border border-emerald-500/50 cursor-pointer hover:bg-emerald-500/30"
            onClick={() => {
              if (confirm("Sign out?")) {
                setIdentifiedUser(null);
                setIdentificationStatus("Signed out.");
                setTimeout(() => setIdentificationStatus(''), 2000);
              }
            }}
          >
            <Fingerprint className="w-3 h-3" />
            Hi, {identifiedUser.name}
          </motion.div>
        )}
        {identificationStatus && !identifiedUser && (
          <div className="absolute right-4 text-xs text-stone-400 animate-pulse">
            {identificationStatus}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {messages.map((m, i) => (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            key={i} 
            className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div className={`max-w-[80%] p-4 rounded-2xl ${m.role === 'user' ? 'bg-amber-100 text-amber-900 rounded-br-sm' : 'bg-stone-100 text-stone-800 rounded-bl-sm'}`}>
              {m.content}
            </div>
          </motion.div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-stone-100 p-4 rounded-2xl rounded-bl-sm flex gap-1 items-center">
              <div className="w-2 h-2 bg-stone-400 rounded-full animate-bounce" />
              <div className="w-2 h-2 bg-stone-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
              <div className="w-2 h-2 bg-stone-400 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }} />
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      <AnimatePresence>
        {receipt && (
          <motion.div 
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            className="absolute inset-0 bg-white/95 backdrop-blur-sm z-10 flex flex-col items-center justify-center p-8"
          >
            <div className="bg-white border border-stone-200 shadow-xl rounded-xl p-8 w-full max-w-sm">
              <h2 className="text-2xl font-bold text-center mb-6 font-serif">Receipt</h2>
              <div className="space-y-4 mb-6">
                {receipt.items.map((item: any, i: number) => (
                  <div key={i} className="flex justify-between text-sm">
                    <div>
                      <div className="font-medium">{item.quantity}x {item.size} {item.temperature} {item.product_name}</div>
                      <div className="text-stone-500 text-xs mt-1">
                        {[item.milk, item.sweetness, item.ice, ...(item.add_ons || [])].filter(Boolean).join(', ')}
                      </div>
                    </div>
                    <div className="font-medium">${item.price.toFixed(2)}</div>
                  </div>
                ))}
              </div>
              <div className="border-t border-stone-200 pt-4 flex justify-between font-bold text-lg">
                <span>Total</span>
                <span>${receipt.total_price.toFixed(2)}</span>
              </div>
              
              {waitTime !== null && (
                <div className="mt-4 bg-amber-50 border border-amber-100 p-3 rounded-lg text-center">
                  <p className="text-amber-800 text-sm font-medium">Estimated Wait Time</p>
                  <p className="text-amber-900 font-bold text-lg">~{waitTime} mins</p>
                </div>
              )}

              <div className="mt-8 text-center space-y-3">
                <p className="text-stone-500 text-sm mb-4">Order for: <span className="font-bold text-stone-900">{receipt.customer_name}</span></p>
                
                {!identifiedUser && !isEnrolling && !enrollmentStatus && (
                  <button
                    onClick={startEnrollment}
                    className="w-full flex items-center justify-center gap-2 bg-amber-100 text-amber-900 px-6 py-2 rounded-full font-medium hover:bg-amber-200 transition-colors text-sm"
                  >
                    <UserPlus className="w-4 h-4" />
                    Save me as a Regular
                  </button>
                )}

                {enrollmentStatus && (
                  <div className="text-sm font-medium text-amber-600 animate-pulse">
                    {enrollmentStatus}
                  </div>
                )}

                <button 
                  onClick={() => { setReceipt(null); setWaitTime(null); setMessages([{ role: 'assistant', content: "Hi! Welcome to NYC Coffee. What can I get started for you today?" }]); }}
                  className="w-full bg-stone-900 text-white px-6 py-2 rounded-full font-medium hover:bg-stone-800 transition-colors"
                >
                  Start New Order
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="p-4 bg-stone-50 border-t border-stone-200">
        <div className="flex justify-center mb-4">
          <button 
            onClick={() => setIsVoiceMode(!isVoiceMode)}
            className="text-xs font-medium text-stone-500 flex items-center gap-1 hover:text-stone-800 transition-colors"
          >
            {isVoiceMode ? <><Keyboard className="w-3 h-3" /> Switch to Text</> : <><Mic className="w-3 h-3" /> Switch to Voice</>}
          </button>
        </div>

        {isVoiceMode ? (
          <div className="flex justify-center pb-4">
            <button
              onClick={toggleRecording}
              className={`w-20 h-20 rounded-full flex items-center justify-center transition-all shadow-lg ${isRecording ? 'bg-red-500 text-white animate-pulse scale-110' : 'bg-stone-900 text-white hover:bg-stone-800'}`}
            >
              {isRecording ? <MicOff className="w-8 h-8" /> : <Mic className="w-8 h-8" />}
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSend(input)}
              placeholder="Type your order here..."
              className="flex-1 border border-stone-300 rounded-full px-6 py-3 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
            <button 
              onClick={() => handleSend(input)}
              disabled={!input.trim() || isLoading}
              className="bg-stone-900 text-white p-3 rounded-full hover:bg-stone-800 disabled:opacity-50 transition-colors"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
