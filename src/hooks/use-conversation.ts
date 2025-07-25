"use client";

import { useState, useCallback } from "react";
import useSWR, { mutate } from 'swr';
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { Message } from "@/types/llm-response";
import { getLLMResponse } from "@/actions/ai/getLLMResponse";
import { approveAndGenerateVideo } from "@/actions/server/handleApproval";
import rejectGenerateVideo from "@/actions/server/handleRejection";
import axios from "axios";

const fetcher = (url: string) => axios.get(url).then(res => res.data);

export function useConversation(conversationId: string | null) {
  const router = useRouter();
  const { data: session } = useSession();
  const user = session?.user;

  const { data: messages = [], mutate: mutateMessages, error } = useSWR<Message[]>(
    user && conversationId ? `/api/chat/${conversationId}` : null,
    fetcher,
    {
      onError: (err) => {
        console.error(err);
        if (conversationId) {
          toast.error(`Unable to load conversation ${conversationId}`);
          router.push('/chat');
        }
      }
    }
  );

  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [loadingMessageId, setLoadingMessageId] = useState<string | null>(null);

  const handleSendMessage = useCallback(async (userPrompt: string) => {
    if (!userPrompt.trim() || !user || !conversationId) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: userPrompt,
      timestamp: new Date(),
    };

    await mutateMessages(prev => [...(prev || []), userMessage], false);
    setIsSendingMessage(true);

    try {
      const { assistantResponse, newTitleGenerated } = await getLLMResponse({
        conversationId,
        userId: user.id,
        userPrompt,
      });

      if (newTitleGenerated) {
        mutate("/api/conversations");
      }

      await mutateMessages(prev => [...(prev || []), assistantResponse], false);
    } catch (error) {
      console.error("Error sending message:", error);
      toast.error("Failed to send message. Please try again.");
      // Remove the user message if there was an error
      await mutateMessages(prev => prev?.slice(0, -1) || [], false);
    } finally {
      setIsSendingMessage(false);
    }
  }, [user, conversationId, mutateMessages]);

  const handleApproveCode = useCallback(async (messageId: string, codeContent: string) => {
    setLoadingMessageId(messageId);
    try {
      const quality = "-qm";
      const res = await approveAndGenerateVideo(messageId, codeContent, quality);

      if (res.status === 'success' && res.videoId) {
        toast.success(res.message);
        mutateMessages(currentMessages =>
          currentMessages?.map(msg =>
            msg.id === messageId
              ? { ...msg, isApproved: true, isRejected: false, videoId: res.videoId }
              : msg
          ), false);
      } else {
        throw new Error(res.message || "Failed to generate video.");
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Failed to generate video. Please try again.";
      toast.error(errorMessage);
    } finally {
      setLoadingMessageId(null);
    }
  }, [mutateMessages]);

  const handleRejectCode = useCallback(async (messageId: string) => {
    setLoadingMessageId(messageId);
    try {
      const result = await rejectGenerateVideo(messageId);
      if (result.success) {
        toast.info("Code rejected. Please describe the changes you need in your next message.");
        mutateMessages(currentMessages =>
          currentMessages?.map(m =>
            m.id === messageId ? { ...m, isRejected: true, isApproved: false } : m
          ), false);
      } else {
        toast.error(result.message);
      }
    } catch (err: unknown) {
      console.error("Rejection failed:", err);
      toast.error("Rejection failed, please try again later.");
    } finally {
      setLoadingMessageId(null);
    }
  }, [mutateMessages]);

  return {
    messages,
    isLoading: !messages && !error,
    isSendingMessage,
    loadingMessageId,
    handleSendMessage,
    handleApproveCode,
    handleRejectCode,
  };
}