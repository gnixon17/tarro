import { useState, useEffect } from 'react';
import { Play, CheckCircle2, XCircle, Loader2, Key } from 'lucide-react';
import { processChatTurn, Message } from '../services/gemini';

// A subset of the torture tests to run automatically
const TORTURE_TESTS = [
  {
    id: 'T01',
    name: 'The Hot Frappuccino (Guardrail)',
    transcript: [
      { role: 'user', content: 'Can I get a hot frappuccino?' }
    ],
    expectedAction: 'clarify', // Should not call finalize_order
    notes: 'Proves the AI enforces the "Frappuccinos are only iced" rule.'
  },
  {
    id: 'T02',
    name: 'The Caffeine Overdose (Guardrail)',
    transcript: [
      { role: 'user', content: 'I need a large iced americano with 8 extra shots of espresso. Name is Bob.' }
    ],
    expectedAction: 'clarify', // Should reject 8 shots, offer 6
    notes: 'Proves the 6-shot maximum limit.'
  },
  {
    id: 'T03',
    name: 'The Sugar Coma (Guardrail)',
    transcript: [
      { role: 'user', content: 'Medium hot latte with 10 pumps of vanilla. Name is Sue.' }
    ],
    expectedAction: 'clarify',
    notes: 'Proves the 8-pump syrup limit.'
  },
  {
    id: 'T04',
    name: 'The Sized Pastry (Guardrail)',
    transcript: [
      { role: 'user', content: 'I will take a large butter croissant. Name is Tom.' }
    ],
    expectedAction: 'clarify',
    notes: 'Proves pastries cannot have sizes.'
  },
  {
    id: 'T05',
    name: 'The Iced Cookie (Guardrail)',
    transcript: [
      { role: 'user', content: 'Can I get an iced chocolate chip cookie?' }
    ],
    expectedAction: 'clarify',
    notes: 'Proves the no iced pastries rule.'
  },
  {
    id: 'T06',
    name: 'The Warm Milk Latte (Guardrail)',
    transcript: [
      { role: 'user', content: 'I want a hot latte, but without any espresso.' }
    ],
    expectedAction: 'clarify',
    notes: 'Proves the AI understands the composition of a latte.'
  },
  {
    id: 'T07',
    name: 'The Hot Cold Brew (Guardrail)',
    transcript: [
      { role: 'user', content: 'Small hot cold brew, please.' }
    ],
    expectedAction: 'clarify',
    notes: 'Proves the Cold brew is only iced rule.'
  },
  {
    id: 'T08',
    name: 'The Off-Menu Alcohol (Guardrail)',
    transcript: [
      { role: 'user', content: 'Give me a large IPA beer.' }
    ],
    expectedAction: 'clarify',
    notes: 'Proves the AI rejects off-menu items.'
  },
  {
    id: 'T09',
    name: 'The Off-Menu Food (Guardrail)',
    transcript: [
      { role: 'user', content: 'I will take a cheeseburger and fries.' }
    ],
    expectedAction: 'clarify',
    notes: 'Proves the AI rejects off-menu food.'
  },
  {
    id: 'T10',
    name: 'The Sugar-Free Caramel (Guardrail)',
    transcript: [
      { role: 'user', content: 'Medium iced latte with caramel syrup, but make it 0% sweet.' }
    ],
    expectedAction: 'clarify',
    notes: 'Proves the AI understands ingredient contradictions.'
  },
  {
    id: 'T11',
    name: 'The Hot Drink with Ice (Guardrail)',
    transcript: [
      { role: 'user', content: 'Small hot americano, but add extra ice.' }
    ],
    expectedAction: 'clarify',
    notes: 'Proves the AI prevents ice in hot drinks.'
  },
  {
    id: 'T12',
    name: 'The Unblended Frappuccino (Guardrail)',
    transcript: [
      { role: 'user', content: 'Large frappuccino, no ice.' }
    ],
    expectedAction: 'clarify',
    notes: 'Proves the AI understands the physical constraints of a blended drink.'
  },
  {
    id: 'T13',
    name: 'The Contradictory Temperature (Guardrail)',
    transcript: [
      { role: 'user', content: 'I want an extra hot iced latte.' }
    ],
    expectedAction: 'clarify',
    notes: 'Proves the AI catches direct logical contradictions.'
  },
  {
    id: 'T14',
    name: 'The Double Guardrail Matcha (Guardrail)',
    transcript: [
      { role: 'user', content: 'Large hot matcha latte with 7 shots of espresso.' }
    ],
    expectedAction: 'clarify',
    notes: 'Proves the AI applies the 6-shot limit even to non-coffee base drinks.'
  },
  {
    id: 'T15',
    name: 'The Double Guardrail Syrup (Guardrail)',
    transcript: [
      { role: 'user', content: 'Small iced cold brew with 9 pumps of vanilla and 9 pumps of caramel.' }
    ],
    expectedAction: 'clarify',
    notes: 'Proves the AI calculates total syrup pumps across multiple flavors.'
  },
  {
    id: 'T16',
    name: 'Mid-Sentence Pivot (Messy Speech)',
    transcript: [
      { role: 'user', content: 'I want a medium hot latte, actually no wait, make it a small iced americano. Name is Dan.' }
    ],
    expectedAction: 'finalize_order',
    expectedItems: ['Americano'],
    notes: 'Proves the AI listens to the final intent, ignoring the false start.'
  },
  {
    id: 'T17',
    name: 'Late Size Change (Messy Speech)',
    transcript: [
      { role: 'user', content: 'I will take a cold brew. Oh, make it a large. Name is Eve.' }
    ],
    expectedAction: 'finalize_order',
    expectedItems: ['Cold Brew'],
    notes: 'Proves the AI can retroactively apply modifiers to an item.'
  },
  {
    id: 'T18',
    name: 'Filler Words & Stuttering (Messy Speech)',
    transcript: [
      { role: 'user', content: 'Umm, hi, yeah, uhh, can I just get like, a, um, medium hot latte? Name is Finn.' }
    ],
    expectedAction: 'finalize_order',
    expectedItems: ['Latte'],
    notes: 'Proves the AI ignores disfluencies.'
  },
  {
    id: 'T19',
    name: 'Late Milk Change (Messy Speech)',
    transcript: [
      { role: 'user', content: 'Two large hot lattes. Wait, make one of them with oat milk. Name is Greg.' }
    ],
    expectedAction: 'finalize_order',
    expectedItems: ['Latte', 'Latte'],
    notes: 'Proves the AI can split a grouped item based on a late modifier.'
  },
  {
    id: 'T20',
    name: 'Item Removal (Messy Speech)',
    transcript: [
      { role: 'user', content: 'A medium iced latte and a cookie. Actually, drop the cookie. Just the latte. Name is Hal.' }
    ],
    expectedAction: 'finalize_order',
    expectedItems: ['Latte'],
    notes: 'Proves the AI can delete items from the draft order.'
  },
  {
    id: 'T21',
    name: 'Quantity Change (Messy Speech)',
    transcript: [
      { role: 'user', content: 'One large frappuccino. Actually, my friends want some too, make it three. Name is Ivy.' }
    ],
    expectedAction: 'finalize_order',
    expectedItems: ['Frappuccino'],
    notes: 'Proves the AI can update quantities.'
  },
  {
    id: 'T22',
    name: 'Vague Request (Messy Speech)',
    transcript: [
      { role: 'user', content: 'I want something sweet and cold.' }
    ],
    expectedAction: 'clarify',
    notes: 'Proves the AI can act as a recommender.'
  },
  {
    id: 'T23',
    name: 'The Run-On Sentence (Messy Speech)',
    transcript: [
      { role: 'user', content: 'Gimme a large iced oat latte with vanilla and a hot small americano and two cookies that is it name is Jack.' }
    ],
    expectedAction: 'finalize_order',
    expectedItems: ['Latte', 'Americano', 'Chocolate Chip Cookie'],
    notes: 'Proves the AI can parse dense, multi-intent strings.'
  },
  {
    id: 'T26',
    name: 'The Office Run (Complex)',
    transcript: [
      { role: 'user', content: 'I need a small hot americano, a large iced matcha with oat milk, a medium hot latte, a croissant, and a cookie. Name is Mia.' }
    ],
    expectedAction: 'finalize_order',
    expectedItems: ['Americano', 'Matcha Latte', 'Latte', 'Butter Croissant', 'Chocolate Chip Cookie'],
    notes: 'Proves the AI can handle 5 distinct items with mixed modifiers.'
  },
  {
    id: 'T32',
    name: 'Implicit Temperatures (Complex)',
    transcript: [
      { role: 'user', content: 'Large cold brew and a small matcha. Name is Sam.' }
    ],
    expectedAction: 'clarify', // Should ask for matcha temperature
    notes: 'Proves the AI knows Cold Brew is iced, but prompts for missing Matcha temp.'
  }
];

export default function TestRunner() {
  const [results, setResults] = useState<Record<string, any>>({});
  const [isRunning, setIsRunning] = useState(false);
  const [customApiKey, setCustomApiKey] = useState(localStorage.getItem('custom_gemini_api_key') || '');

  useEffect(() => {
    localStorage.setItem('custom_gemini_api_key', customApiKey);
  }, [customApiKey]);

  const runTest = async (test: typeof TORTURE_TESTS[0], retryCount = 0) => {
    setResults(prev => ({ ...prev, [test.id]: { status: 'running' } }));
    
    try {
      // Add the initial assistant greeting to match real flow
      const messages: Message[] = [
        { role: 'assistant', content: "Hi! Welcome to NYC Coffee. What can I get started for you today?" },
        ...(test.transcript as Message[])
      ];

      const response = await processChatTurn(messages, customApiKey || undefined);
      
      let passed = false;
      let reason = '';

      if (test.expectedAction === 'finalize_order') {
        if (response.functionCall?.name === 'finalize_order') {
          const args = response.functionCall.args as any;
          const returnedItems = args.items.map((i: any) => i.product_name);
          
          // Check if all expected items are present
          const hasAllItems = test.expectedItems?.every(item => returnedItems.includes(item));
          if (hasAllItems) {
            passed = true;
          } else {
            reason = `Missing expected items. Got: ${returnedItems.join(', ')}`;
          }
        } else {
          reason = `Expected finalize_order, but got text response: "${response.text}"`;
        }
      } else if (test.expectedAction === 'clarify') {
        if (!response.functionCall) {
          passed = true; // Successfully clarified instead of finalizing
        } else {
          reason = `Expected clarification, but AI finalized the order.`;
        }
      }

      setResults(prev => ({ 
        ...prev, 
        [test.id]: { 
          status: passed ? 'passed' : 'failed', 
          reason,
          response: response.functionCall ? JSON.stringify(response.functionCall.args, null, 2) : response.text
        } 
      }));

    } catch (e: any) {
      // Handle 429 Rate Limit Errors with Retry
      if (e.message?.includes('429') || e.message?.includes('quota') || e.status === 429) {
        if (retryCount < 3) {
          const waitTime = 60000; // Wait 60 seconds before retry
          setResults(prev => ({ 
            ...prev, 
            [test.id]: { status: 'running', reason: `Rate limit hit. Retrying in ${waitTime/1000}s... (Attempt ${retryCount + 1}/3)` } 
          }));
          await new Promise(r => setTimeout(r, waitTime));
          return runTest(test, retryCount + 1);
        } else {
          setResults(prev => ({ 
            ...prev, 
            [test.id]: { status: 'failed', reason: "Rate limit exceeded after 3 retries. Please try again later." } 
          }));
          return;
        }
      }

      setResults(prev => ({ 
        ...prev, 
        [test.id]: { status: 'failed', reason: e.message } 
      }));
    }
  };

  const runAllTests = async () => {
    setIsRunning(true);
    for (const test of TORTURE_TESTS) {
      await runTest(test);
      // 10-second delay to be extremely safe with Gemini free tier rate limits
      await new Promise(r => setTimeout(r, 10000));
    }
    setIsRunning(false);
  };

  return (
    <div className="max-w-4xl mx-auto pb-12">
      <div className="flex justify-between items-end mb-8">
        <div>
          <h1 className="text-3xl font-bold font-serif text-stone-900">Test Runner</h1>
          <p className="text-stone-500 mt-1">Automated "Torture Tests" for the AI Cashier.</p>
        </div>
        <button 
          onClick={runAllTests}
          disabled={isRunning}
          className="flex items-center gap-2 bg-stone-900 text-white px-6 py-2 rounded-lg font-medium hover:bg-stone-800 disabled:opacity-50 transition-colors"
        >
          {isRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          Run All Tests
        </button>
      </div>

      <div className="bg-white p-6 rounded-xl border border-stone-200 shadow-sm mb-8">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-stone-100 rounded-lg text-stone-600">
            <Key className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-stone-900">Custom API Key</h3>
            <p className="text-sm text-stone-500">Override the default environment key for testing.</p>
          </div>
        </div>
        <input
          type="password"
          value={customApiKey}
          onChange={(e) => setCustomApiKey(e.target.value)}
          placeholder="Enter Gemini API Key (starts with AIza...)"
          className="w-full border border-stone-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500 font-mono text-sm"
        />
        <p className="text-xs text-stone-400 mt-2">
          This key is stored locally in your browser and is only used for these tests.
        </p>
      </div>

      <div className="space-y-4">
        {TORTURE_TESTS.map(test => {
          const res = results[test.id];
          return (
            <div key={test.id} className="bg-white border border-stone-200 rounded-xl overflow-hidden shadow-sm">
              <div className="p-4 border-b border-stone-100 flex justify-between items-center bg-stone-50">
                <div className="flex items-center gap-3">
                  {res?.status === 'running' && <Loader2 className="w-5 h-5 text-amber-500 animate-spin" />}
                  {res?.status === 'passed' && <CheckCircle2 className="w-5 h-5 text-emerald-500" />}
                  {res?.status === 'failed' && <XCircle className="w-5 h-5 text-red-500" />}
                  {!res && <div className="w-5 h-5 rounded-full border-2 border-stone-300" />}
                  
                  <h3 className="font-bold text-stone-800">{test.id}: {test.name}</h3>
                </div>
                <button 
                  onClick={() => runTest(test)}
                  disabled={isRunning || res?.status === 'running'}
                  className="text-sm font-medium text-stone-500 hover:text-stone-900 disabled:opacity-50"
                >
                  Run Single
                </button>
              </div>
              
              <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="font-medium text-stone-500 mb-2 uppercase tracking-wide text-xs">Transcript</div>
                  <div className="space-y-2">
                    {test.transcript.map((m, i) => (
                      <div key={i} className="bg-stone-100 p-2 rounded-lg text-stone-800">
                        <span className="font-bold mr-2">{m.role === 'user' ? 'User:' : 'AI:'}</span>
                        {m.content}
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 text-stone-500 italic text-xs">{test.notes}</div>
                </div>
                
                <div>
                  <div className="font-medium text-stone-500 mb-2 uppercase tracking-wide text-xs">Result</div>
                  {res ? (
                    <div className={`p-3 rounded-lg border ${res.status === 'passed' ? 'bg-emerald-50 border-emerald-100 text-emerald-900' : res.status === 'failed' ? 'bg-red-50 border-red-100 text-red-900' : 'bg-amber-50 border-amber-100 text-amber-900'}`}>
                      {res.status === 'failed' && (
                        <div className="font-bold mb-2">Error: {res.reason}</div>
                      )}
                      <div className="font-mono text-xs whitespace-pre-wrap overflow-x-auto">
                        {res.response || 'Running...'}
                      </div>
                    </div>
                  ) : (
                    <div className="text-stone-400 italic">Not run yet.</div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
