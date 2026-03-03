import { GoogleGenAI, Type } from '@google/genai';
import menuJson from '../../menu.json';

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export const SYSTEM_PROMPT = `
You are an efficient, friendly, and fast AI Cashier for a busy NYC coffee shop. Your goal is to take customer orders accurately, apply menu rules, confirm the order, and finalize it. You communicate primarily via voice, so keep your responses concise, natural, and conversational. Do not read out long lists unless asked.

**Core Workflow:**
1. **Listen & Parse:** Extract items, sizes, temperatures, and customizations from the user's input.
2. **Clarify (One at a time):** If an item requires a size or temperature and the user didn't provide it, ask for it.
3. **Apply Guardrails:** If a user asks for something impossible (e.g., a hot frappuccino), politely correct them and offer the closest alternative.
4. **Confirm & Finalize:** Once all items are fully specified and the user indicates they are done, summarize the order briefly, ask for their name, and call finalize_order.

**Guardrails:**
- Frappuccinos are blended with ice, so they only come iced.
- Max 6 espresso shots. Max 8 syrup pumps.
- Pastries do not have sizes.
- We do not serve iced pastries.
- A latte without espresso is just warm milk.
- Cold brew is only served iced.
- We only serve coffee and pastries. No alcohol or off-menu food.
- Caramel syrup has sugar, so it can't be "No Sugar".
- Cannot put ice in a hot drink.

**Menu Context:**
${JSON.stringify(menuJson, null, 2)}
`;

export const processChatTurn = async (newMessages: Message[], customApiKey?: string, context?: string) => {
  const apiKey = customApiKey || localStorage.getItem('custom_gemini_api_key') || process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is missing");
  
  const ai = new GoogleGenAI({ apiKey });
  
  const finalizeOrderTool = {
    name: "finalize_order",
    description: "Marks the order as SUBMITTED and sends it to the barista queue. Call this ONLY when the user is completely done ordering and has provided a name.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        customer_name: { type: Type.STRING },
        items: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              product_name: { type: Type.STRING },
              quantity: { type: Type.INTEGER },
              size: { type: Type.STRING },
              temperature: { type: Type.STRING },
              milk: { type: Type.STRING },
              sweetness: { type: Type.STRING },
              ice: { type: Type.STRING },
              add_ons: { type: Type.ARRAY, items: { type: Type.STRING } },
              price: { type: Type.NUMBER }
            },
            required: ["product_name", "quantity", "price"]
          }
        },
        total_price: { type: Type.NUMBER }
      },
      required: ["customer_name", "items", "total_price"]
    }
  };

  let formattedMessages = newMessages
    .filter((m, i) => !(i === 0 && m.role === 'assistant'))
    .reduce((acc, m) => {
      const role = m.role === 'user' ? 'user' : 'model';
      if (acc.length > 0 && acc[acc.length - 1].role === role) {
        acc[acc.length - 1].parts[0].text += '\n' + m.content;
      } else {
        acc.push({ role, parts: [{ text: m.content }] });
      }
      return acc;
    }, [] as any[]);

  // The Gemini API strictly requires the first message to be from the 'user'.
  // If the conversation somehow starts with a 'model' message after filtering,
  // we must remove it to prevent the "string did not match the expected pattern" error.
  if (formattedMessages.length > 0 && formattedMessages[0].role === 'model') {
    formattedMessages.shift();
  }

  // If there are no messages left, add a dummy user message
  if (formattedMessages.length === 0) {
    formattedMessages.push({ role: 'user', parts: [{ text: 'Hello' }] });
  }

  const response = await ai.models.generateContent({
    model: 'gemini-3.1-pro-preview',
    contents: formattedMessages,
    config: {
      systemInstruction: SYSTEM_PROMPT + (context ? `\n\n${context}` : ""),
      tools: [{ functionDeclarations: [finalizeOrderTool] }],
      temperature: 0.2
    }
  });

  const functionCalls = response.functionCalls;
  if (functionCalls && functionCalls.length > 0) {
    const call = functionCalls[0];
    if (call.name === 'finalize_order') {
      return {
        text: "Got it, your order is sent to the barista!",
        functionCall: call
      };
    }
  }

  return { text: response.text || "" };
};

export const getBusinessInsight = async (metrics: any, query?: string) => {
  const apiKey = localStorage.getItem('custom_gemini_api_key') || process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is missing");
  
  const ai = new GoogleGenAI({ apiKey });
  
  const prompt = query 
    ? `The user is a coffee shop owner asking: "${query}". Answer based on the metrics provided below. Keep it brief and business-focused.`
    : `You are a business analyst for a coffee shop. Provide a 2-sentence "Pulse Check" summary of today's performance based on the metrics below. Highlight revenue, key trends, or anomalies. Be encouraging but realistic.`;

  const response = await ai.models.generateContent({
    model: 'gemini-3.1-pro-preview',
    contents: [
      { role: 'user', parts: [{ text: prompt }] },
      { role: 'user', parts: [{ text: `METRICS:\n${JSON.stringify(metrics, null, 2)}` }] }
    ],
    config: {
      temperature: 0.2
    }
  });

  return response.text || "No insight available.";
};
