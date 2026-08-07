
import { GoogleGenAI } from "@google/genai";

const API_KEY = process.env.API_KEY || process.env.VITE_GEMINI_API_KEY || '';

let _ai: GoogleGenAI | null = null;

function getAI(): GoogleGenAI | null {
  if (!API_KEY) return null;
  if (!_ai) {
    try {
      _ai = new GoogleGenAI({ apiKey: API_KEY });
    } catch {
      return null;
    }
  }
  return _ai;
}

const NO_KEY_MSG = "Gemini API key not configured. AI features are unavailable.";

export const getPurchaseInsights = async (prompt: string): Promise<string> => {
  const ai = getAI();
  if (!ai) return NO_KEY_MSG;
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `You are a purchase management expert. Based on the following user query, provide a concise analysis or recommendation. Query: "${prompt}"`,
      config: {
        systemInstruction: "Analyze purchasing data and provide actionable insights for a supply chain manager. Keep responses brief and to the point.",
        temperature: 0.5,
        topP: 0.95,
      }
    });
    return response.text || "No insights could be generated.";
  } catch (error) {
    console.error("Error calling Gemini API:", error);
    if (error instanceof Error) return `An error occurred while fetching insights: ${error.message}`;
    return "An unknown error occurred while fetching insights.";
  }
};

export const getSuggestedPricing = async (cost: number, name: string, category: string): Promise<number | string> => {
  const ai = getAI();
  if (!ai) return NO_KEY_MSG;
  const prompt = `As an e-commerce pricing expert for hobbyist products like speed cubes, suggest a competitive Maximum Retail Price (MRP) for the following item. Provide only the numerical value, no currency signs or extra text.
    - Product Name: ${name}
    - Product Category: ${category}
    - Cost Price: $${cost.toFixed(2)}`;
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        systemInstruction: "You are a pricing bot. Your only job is to return a single numerical price value based on the user's input. Do not add any explanatory text.",
        temperature: 0.2,
      }
    });
    const priceText = (response.text || "").trim().replace(/[^0-9.]/g, '');
    const price = parseFloat(priceText);
    return !isNaN(price) ? price : "Could not determine price.";
  } catch (error) {
    console.error("Error calling Gemini API for pricing:", error);
    if (error instanceof Error) return `Pricing error: ${error.message}`;
    return "Pricing error.";
  }
};

export const getSuggestedShopifyPrice = async (landingCost: number, name: string, category: string): Promise<number | string> => {
  const ai = getAI();
  if (!ai) return NO_KEY_MSG;
  const prompt = `As an e-commerce expert for hobbyist products like speed cubes, suggest a competitive Shopify selling price. The landing cost in INR is provided. Return only a single numerical value, no currency signs or extra text.
    - Product Name: ${name}
    - Product Category: ${category}
    - Landing Cost: ₹${landingCost.toFixed(2)}`;
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        systemInstruction: "You are a pricing bot. Your only job is to return a single numerical price value based on the user's input. Do not add any explanatory text.",
        temperature: 0.2,
      }
    });
    const priceText = (response.text || "").trim().replace(/[^0-9.]/g, '');
    const price = parseFloat(priceText);
    return !isNaN(price) ? price : "Could not determine Shopify price.";
  } catch (error) {
    console.error("Error calling Gemini API for Shopify pricing:", error);
    if (error instanceof Error) return `Shopify pricing error: ${error.message}`;
    return "Shopify pricing error.";
  }
};

const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // result is "data:<mime>;base64,<data>" — strip the prefix, Gemini wants raw base64
      const base64 = result.split(',')[1] || '';
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

/**
 * Extracts a suggested total invoice amount from an uploaded CNF agent invoice
 * file (PDF/image). Always treat the result as a suggestion to review, never as
 * authoritative — OCR can misread scans, and this feeds a real financial
 * reconciliation check.
 */
export const extractInvoiceAmount = async (file: File): Promise<{ amount: number | null; rawText: string }> => {
  const ai = getAI();
  if (!ai) return { amount: null, rawText: NO_KEY_MSG };
  try {
    const base64Data = await fileToBase64(file);
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: [
        { inlineData: { mimeType: file.type, data: base64Data } },
        { text: 'This is an invoice document. Extract only the final total/grand total amount as a plain number, no currency symbols, no commas, no explanatory text. If you cannot find a clear total, respond with exactly: UNKNOWN' }
      ],
      config: {
        systemInstruction: 'You are an invoice-reading assistant. Your only job is to return a single numerical total amount, or the literal word UNKNOWN if none is found.',
        temperature: 0.1,
      }
    });
    const rawText = (response.text || '').trim();
    if (rawText === 'UNKNOWN') return { amount: null, rawText };
    const cleaned = rawText.replace(/[^0-9.]/g, '');
    const amount = parseFloat(cleaned);
    return { amount: !isNaN(amount) ? amount : null, rawText };
  } catch (error) {
    console.error('Error calling Gemini API for invoice extraction:', error);
    return { amount: null, rawText: error instanceof Error ? error.message : 'Unknown error' };
  }
};
