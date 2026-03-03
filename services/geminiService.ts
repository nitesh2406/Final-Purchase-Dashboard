
import { GoogleGenAI } from "@google/genai";

// FIX: Correctly initialized GoogleGenAI with a named parameter using process.env.API_KEY.
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const getPurchaseInsights = async (prompt: string): Promise<string> => {
  try {
    // FIX: Using recommended model 'gemini-3-flash-preview' for basic text tasks.
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `You are a purchase management expert. Based on the following user query, provide a concise analysis or recommendation. Query: "${prompt}"`,
      config: {
        systemInstruction: "Analyze purchasing data and provide actionable insights for a supply chain manager. Keep responses brief and to the point.",
        temperature: 0.5,
        topP: 0.95,
      }
    });

    // FIX: Directly accessing the .text property of GenerateContentResponse.
    return response.text || "No insights could be generated.";
  } catch (error) {
    console.error("Error calling Gemini API:", error);
    if (error instanceof Error) {
        return `An error occurred while fetching insights: ${error.message}`;
    }
    return "An unknown error occurred while fetching insights.";
  }
};

export const getSuggestedPricing = async (cost: number, name: string, category: string): Promise<number | string> => {
    const prompt = `As an e-commerce pricing expert for hobbyist products like speed cubes, suggest a competitive Maximum Retail Price (MRP) for the following item. Provide only the numerical value, no currency signs or extra text.
    - Product Name: ${name}
    - Product Category: ${category}
    - Cost Price: $${cost.toFixed(2)}`;

    try {
        // FIX: Using recommended model 'gemini-3-flash-preview'.
        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: prompt,
            config: {
                systemInstruction: "You are a pricing bot. Your only job is to return a single numerical price value based on the user's input. Do not add any explanatory text.",
                temperature: 0.2,
            }
        });
        
        // FIX: Access .text property directly.
        const priceText = (response.text || "").trim().replace(/[^0-9.]/g, '');
        const price = parseFloat(priceText);
        
        if (!isNaN(price)) {
            return price;
        } else {
            return "Could not determine price.";
        }

    } catch (error) {
        console.error("Error calling Gemini API for pricing:", error);
        if (error instanceof Error) {
            return `Pricing error: ${error.message}`;
        }
        return "Pricing error.";
    }
};

export const getSuggestedShopifyPrice = async (landingCost: number, name: string, category: string): Promise<number | string> => {
    const prompt = `As an e-commerce expert for hobbyist products like speed cubes, suggest a competitive Shopify selling price. The landing cost in INR is provided. Return only a single numerical value, no currency signs or extra text.
    - Product Name: ${name}
    - Product Category: ${category}
    - Landing Cost: ₹${landingCost.toFixed(2)}`;

    try {
        // FIX: Using recommended model 'gemini-3-flash-preview'.
        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: prompt,
            config: {
                systemInstruction: "You are a pricing bot. Your only job is to return a single numerical price value based on the user's input. Do not add any explanatory text.",
                temperature: 0.2,
            }
        });
        
        // FIX: Access .text property directly.
        const priceText = (response.text || "").trim().replace(/[^0-9.]/g, '');
        const price = parseFloat(priceText);
        
        if (!isNaN(price)) {
            return price;
        } else {
            return "Could not determine Shopify price.";
        }

    } catch (error) {
        console.error("Error calling Gemini API for Shopify pricing:", error);
        if (error instanceof Error) {
            return `Shopify pricing error: ${error.message}`;
        }
        return "Shopify pricing error.";
    }
};
