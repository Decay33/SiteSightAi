import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI } from '@google/genai';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Globe, Sparkles, ArrowRight, Loader2, Bot, User, Info } from 'lucide-react';
import Markdown from 'react-markdown';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

type Message = {
  role: 'user' | 'assistant';
  content: string;
};

export default function App() {
  const [url, setUrl] = useState('https://www.anthropic.com');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [summary, setSummary] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const analyzeWebsite = async () => {
    if (!url) return;
    setLoading(true);
    setSummary('');
    setMessages([]);
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Please provide a comprehensive summary of this website: ${url}. What is it about? What are its main features or offerings? Who is the target audience? Keep it concise and easy to read.`,
        config: {
          tools: [{ urlContext: {} }, { googleSearch: {} }]
        }
      });
      setSummary(response.text || 'No summary available.');
    } catch (error) {
      console.error(error);
      setSummary('Error analyzing the website. Please check the URL or try again later.');
    } finally {
      setLoading(false);
    }
  };

  const askQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || !url) return;
    
    const userMessage = query;
    setQuery('');
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setLoading(true);
    
    try {
      const chatHistory = messages.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n');
      const prompt = `Context: The user is asking about the website ${url}.\n\nPrevious conversation:\n${chatHistory}\n\nUser's new question: ${userMessage}\n\nPlease answer the user's question based on the website context.`;
      
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: {
          tools: [{ urlContext: {} }, { googleSearch: {} }]
        }
      });
      
      setMessages(prev => [...prev, { role: 'assistant', content: response.text || 'No response available.' }]);
    } catch (error) {
      console.error(error);
      setMessages(prev => [...prev, { role: 'assistant', content: 'Error getting an answer. Please try again.' }]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, summary, loading]);

  return (
    <div className="min-h-screen bg-neutral-100 flex items-center justify-center p-4 font-sans">
      {/* Extension Popup Container */}
      <div className="w-[400px] h-[600px] bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col border border-neutral-200">
        
        {/* Header */}
        <div className="bg-indigo-600 text-white p-4 flex items-center gap-3 shrink-0 shadow-sm relative z-10">
          <div className="bg-white/20 p-1.5 rounded-lg">
            <Sparkles className="w-5 h-5 text-indigo-50" />
          </div>
          <div>
            <h1 className="font-semibold text-base tracking-tight leading-tight">SiteSight AI</h1>
            <p className="text-indigo-200 text-xs">Your intelligent browsing assistant</p>
          </div>
        </div>
        
        {/* URL Input (Simulated Active Tab) */}
        <div className="p-4 border-b border-neutral-100 bg-neutral-50 shrink-0">
          <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Info className="w-3 h-3" />
            Simulated Active Tab
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Globe className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
              <input 
                type="url" 
                value={url}
                onChange={e => setUrl(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-white border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all shadow-sm"
                placeholder="https://example.com"
              />
            </div>
            <button 
              onClick={analyzeWebsite}
              disabled={loading || !url}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center min-w-[80px] shadow-sm"
            >
              {loading && !summary && messages.length === 0 ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Analyze'}
            </button>
          </div>
        </div>
        
        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-4 bg-white flex flex-col gap-4 scroll-smooth">
          {!summary && !loading && messages.length === 0 && (
            <div className="flex-1 flex flex-col items-center justify-center text-center text-neutral-400 gap-4 px-6">
              <div className="w-16 h-16 bg-indigo-50 rounded-full flex items-center justify-center mb-2">
                <Search className="w-8 h-8 text-indigo-300" />
              </div>
              <div>
                <h3 className="text-neutral-700 font-medium mb-1">Ready to explore</h3>
                <p className="text-sm">Enter a URL and click Analyze to get AI insights about the current website.</p>
              </div>
            </div>
          )}
          
          {loading && !summary && messages.length === 0 && (
            <div className="flex-1 flex flex-col items-center justify-center text-center text-neutral-400 gap-4">
              <div className="relative">
                <div className="w-16 h-16 bg-indigo-50 rounded-full flex items-center justify-center">
                  <Globe className="w-8 h-8 text-indigo-300" />
                </div>
                <div className="absolute -bottom-1 -right-1 bg-white rounded-full p-1 shadow-sm">
                  <Loader2 className="w-5 h-5 animate-spin text-indigo-600" />
                </div>
              </div>
              <p className="text-sm font-medium text-indigo-600 animate-pulse">Reading website content...</p>
            </div>
          )}
          
          {summary && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-indigo-50/50 rounded-xl p-4 border border-indigo-100/50 shadow-sm"
            >
              <h2 className="text-xs font-bold text-indigo-800 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" />
                Website Summary
              </h2>
              <div className="text-neutral-700 markdown-body">
                <Markdown>{summary}</Markdown>
              </div>
            </motion.div>
          )}
          
          {messages.map((msg, idx) => (
            <motion.div 
              key={idx}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex gap-2 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
            >
              <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-1 ${
                msg.role === 'user' ? 'bg-neutral-200' : 'bg-indigo-100 text-indigo-600'
              }`}>
                {msg.role === 'user' ? <User className="w-3.5 h-3.5 text-neutral-600" /> : <Bot className="w-3.5 h-3.5" />}
              </div>
              <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm shadow-sm ${
                msg.role === 'user' 
                  ? 'bg-indigo-600 text-white rounded-tr-sm' 
                  : 'bg-white border border-neutral-200 text-neutral-800 rounded-tl-sm'
              }`}>
                {msg.role === 'user' ? (
                  msg.content
                ) : (
                  <div className="markdown-body">
                    <Markdown>{msg.content}</Markdown>
                  </div>
                )}
              </div>
            </motion.div>
          ))}
          
          {loading && (summary || messages.length > 0) && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex justify-start gap-2"
            >
              <div className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center shrink-0 mt-1">
                <Bot className="w-3.5 h-3.5" />
              </div>
              <div className="bg-white border border-neutral-200 rounded-2xl rounded-tl-sm px-4 py-3.5 shadow-sm flex items-center gap-1.5 h-[42px]">
                <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </motion.div>
          )}
          <div ref={messagesEndRef} className="h-1" />
        </div>
        
        {/* Chat Input */}
        <div className="p-3 border-t border-neutral-100 bg-white shrink-0 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.02)] relative z-10">
          <form onSubmit={askQuestion} className="relative flex items-center">
            <input 
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={summary ? "Ask about this website..." : "Analyze website first..."}
              disabled={!summary || loading}
              className="w-full pl-4 pr-10 py-2.5 bg-neutral-50 border border-neutral-200 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-neutral-100"
            />
            <button 
              type="submit"
              disabled={!query.trim() || !summary || loading}
              className="absolute right-1.5 p-1.5 bg-indigo-600 text-white rounded-full hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
            >
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        </div>
      </div>
      
      {/* Contextual helper text for the prototype */}
      <div className="absolute bottom-6 text-neutral-400 text-sm max-w-md text-center">
        This is a prototype of a Chrome Extension. In a real extension, the URL would be automatically fetched from the active browser tab.
      </div>
    </div>
  );
}
