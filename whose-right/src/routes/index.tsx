import { useCallback, useState, useEffect, useRef } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { v4 as uuidv4 } from "uuid";

import { orpc } from "@/orpc/client";

/*
which is a higher ranked movie? highlander or highlander 2. jack says highlander 2. lori says highlander.

what's the faster animal? lori says cheeta. jack says eagle.

who has won more stanley cups? lori says canada. jack says usa. if it's canada be sure to say "Oh, Canada!"

who has more youtube subscribers? jack says "Jack Herrington". Jason says "Jason Lengstorf".
*/

import { setupSession } from "@/engine";

interface Message {
  id: string;
  text: string;
  sender: "user" | "ai";
  timestamp: Date;
}

interface Participant {
  name: string;
  score: number;
}

export const Route = createFileRoute("/" as any)({
  component: WhosRightChat,
  loader: async () => {
    const sessionId = uuidv4();
    setupSession(sessionId);
    return {
      sessionId,
    };
  },
});

function WhosRightChat() {
  const { sessionId } = Route.useLoaderData();
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [lastWinner, setLastWinner] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Add welcome message on component mount
  useEffect(() => {
    const welcomeMessage: Message = {
      id: uuidv4(),
      text: "Welcome to Who's Right - The Point-Scoring Debate Game! 🏆 Describe your question or debate, then tell me what each person said. I'll judge who's right and award points. Watch the scoreboard on the left to see who's winning!",
      sender: "ai",
      timestamp: new Date(),
    };
    setMessages([welcomeMessage]);
  }, []);

  // Auto-scroll to bottom when new messages are added
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const { mutate: askAI, isPending: isAsking } = useMutation({
    mutationFn: orpc.ask.call,
    onSuccess: (response) => {
      try {
        // Try to parse as JSON first (new structured format)
        const parsedResponse = JSON.parse(response);

        const aiMessage: Message = {
          id: uuidv4(),
          text: parsedResponse.content,
          sender: "ai",
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, aiMessage]);

        // Update participants if provided
        if (parsedResponse.participants) {
          setParticipants(parsedResponse.participants);
        }

        // Set winner for visual feedback
        if (parsedResponse.type === "judgment" && parsedResponse.winner) {
          setLastWinner(parsedResponse.winner);
          // Clear winner highlight after 3 seconds
          setTimeout(() => setLastWinner(null), 3000);
        }
      } catch (e) {
        // Fallback to old format (plain string)
        const aiMessage: Message = {
          id: uuidv4(),
          text: response,
          sender: "ai",
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, aiMessage]);
      }
      setPrompt("");
    },
    onError: (error) => {
      console.error("Failed to get AI response:", error);
      const errorMessage: Message = {
        id: uuidv4(),
        text: "Sorry, I encountered an error. Please try again.",
        sender: "ai",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    },
  });

  const handleSendMessage = useCallback(() => {
    if (sessionId && prompt.trim()) {
      // Add user message to chat
      const userMessage: Message = {
        id: uuidv4(),
        text: prompt.trim(),
        sender: "user",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, userMessage]);

      // Send to AI
      askAI({ id: sessionId, prompt: prompt.trim() });
      setPrompt("");
    }
  }, [askAI, sessionId, prompt]);

  return (
    <div
      className="flex h-screen bg-gradient-to-br from-purple-100 to-blue-100 text-white"
      style={{
        backgroundImage:
          "radial-gradient(50% 50% at 50% 50%, #D2149D 0%, #8E1066 50%, #2D0A1F 100%)",
      }}
    >
      {/* Sidebar */}
      <div className="w-80 flex-shrink-0 bg-black/30 backdrop-blur-sm border-r border-white/20">
        <div className="p-4 border-b border-white/20">
          <h2 className="text-lg font-bold text-center">🏆 Scoreboard</h2>
        </div>
        <div className="p-4 space-y-3">
          {participants.length === 0 ? (
            <div className="text-center text-white/60 text-sm">
              No participants yet.
              <br />
              Start a debate to see scores!
            </div>
          ) : (
            participants
              .sort((a, b) => b.score - a.score) // Sort by score descending
              .map((participant, index) => (
                <div
                  key={participant.name}
                  className={`p-3 rounded-lg backdrop-blur-sm border transition-all duration-300 ${
                    lastWinner === participant.name
                      ? "bg-yellow-500/30 border-yellow-400 scale-105 shadow-lg"
                      : "bg-white/10 border-white/20"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      {index === 0 && participant.score > 0 && (
                        <span className="text-yellow-400">👑</span>
                      )}
                      <span className="font-medium text-sm">
                        {participant.name}
                      </span>
                    </div>
                    <div className="text-right">
                      <div className="text-xl font-bold text-blue-300">
                        {participant.score}
                      </div>
                      <div className="text-xs text-white/60">
                        {participant.score === 1 ? "point" : "points"}
                      </div>
                    </div>
                  </div>
                </div>
              ))
          )}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="flex-shrink-0 p-4 border-b border-white/20 backdrop-blur-sm bg-black/20">
          <h1 className="text-2xl font-bold text-center">Who's Right?</h1>
          <p className="text-sm text-white/80 text-center mt-1">
            AI Debate Mediator & Point Scorer
          </p>
        </div>

        {/* Messages Container */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${
                message.sender === "user" ? "justify-end" : "justify-start"
              }`}
            >
              <div
                className={`max-w-[80%] p-4 rounded-2xl backdrop-blur-sm shadow-lg ${
                  message.sender === "user"
                    ? "bg-blue-500/80 text-white ml-4"
                    : "bg-white/20 border border-white/30 text-white mr-4"
                }`}
              >
                <p className="text-sm leading-relaxed">{message.text}</p>
                <p
                  className={`text-xs mt-2 opacity-70 ${
                    message.sender === "user"
                      ? "text-blue-100"
                      : "text-white/60"
                  }`}
                >
                  {message.timestamp.toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </div>
            </div>
          ))}

          {/* Typing indicator */}
          {isAsking && (
            <div className="flex justify-start">
              <div className="max-w-[80%] p-4 rounded-2xl backdrop-blur-sm shadow-lg bg-white/20 border border-white/30 text-white mr-4">
                <div className="flex items-center space-x-1">
                  <div className="flex space-x-1">
                    <div className="w-2 h-2 bg-white/60 rounded-full animate-bounce"></div>
                    <div
                      className="w-2 h-2 bg-white/60 rounded-full animate-bounce"
                      style={{ animationDelay: "0.1s" }}
                    ></div>
                    <div
                      className="w-2 h-2 bg-white/60 rounded-full animate-bounce"
                      style={{ animationDelay: "0.2s" }}
                    ></div>
                  </div>
                  <span className="text-xs text-white/60 ml-2">
                    AI is thinking...
                  </span>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="flex-shrink-0 p-4 border-t border-white/20 backdrop-blur-sm bg-black/20">
          <div className="flex gap-2 max-w-4xl mx-auto">
            <input
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
              placeholder="Describe your debate or question..."
              className="flex-1 px-4 py-3 rounded-full border border-white/20 bg-white/10 backdrop-blur-sm text-white placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
              disabled={isAsking}
            />
            <button
              disabled={!sessionId || prompt.trim().length === 0 || isAsking}
              onClick={handleSendMessage}
              className="px-6 py-3 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-500/50 disabled:cursor-not-allowed text-white font-medium rounded-full transition-colors flex items-center gap-2"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                />
              </svg>
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
