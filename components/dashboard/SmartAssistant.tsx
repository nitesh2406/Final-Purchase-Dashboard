
import React, { useState } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { SparklesIcon, ArrowPathIcon } from '../icons/Icons';
import { getPurchaseInsights } from '../../services/geminiService';

const samplePrompts = [
    "Which vendors have the highest cost items?",
    "Summarize inventory status for 3x3 cubes.",
    "Identify potential stockout risks in the next 30 days."
];

export const SmartAssistant: React.FC = () => {
    const [prompt, setPrompt] = useState<string>('');
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [response, setResponse] = useState<string>('');

    const handlePromptSubmit = async (currentPrompt: string) => {
        if (!currentPrompt.trim() || isLoading) return;

        setIsLoading(true);
        setResponse('');
        try {
            const result = await getPurchaseInsights(currentPrompt);
            setResponse(result);
        } catch (error) {
            setResponse('Sorry, I encountered an error. Please try again.');
        } finally {
            setIsLoading(false);
            setPrompt('');
        }
    };
    
    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        handlePromptSubmit(prompt);
    }

    return (
        <Card className="flex flex-col">
            <div className="flex items-center mb-4">
                <SparklesIcon className="w-6 h-6 text-primary-500 mr-2" />
                <h3 className="font-semibold text-lg text-gray-800 dark:text-white">Smart Assistant</h3>
            </div>
            <div className="flex-grow space-y-4">
                <div className="p-4 bg-gray-100 dark:bg-gray-900 rounded-lg min-h-[120px] text-sm text-gray-700 dark:text-gray-300 overflow-y-auto">
                    {isLoading ? (
                        <div className="flex items-center justify-center h-full">
                            <ArrowPathIcon className="w-6 h-6 animate-spin text-primary-500" />
                            <p className="ml-2">Getting insights...</p>
                        </div>
                    ) : (
                        response || "Ask a question about your purchasing data to get AI-powered insights."
                    )}
                </div>
                <div className="flex space-x-2">
                    {samplePrompts.map(p => (
                         <button key={p} onClick={() => handlePromptSubmit(p)} className="text-xs bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 rounded-full px-3 py-1 transition-colors">
                            {p}
                         </button>
                    ))}
                </div>
                <form onSubmit={handleSubmit} className="flex items-center space-x-2">
                    <input
                        type="text"
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        placeholder="e.g., 'Forecast demand for SKU-001'"
                        className="flex-grow bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                        disabled={isLoading}
                    />
                    <Button type="submit" disabled={isLoading || !prompt.trim()}>
                        Ask
                    </Button>
                </form>
            </div>
        </Card>
    );
};
