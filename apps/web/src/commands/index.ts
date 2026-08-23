import type { Hotkey } from "@tanstack/react-hotkeys";
import { useMatch, useNavigate } from "@tanstack/react-router";
import type { ComponentType } from "react";
import { ChatIcon, ComposeIcon } from "@erudane/ui/icons";

/**
 * One entry of the command palette. A `hotkey` here is the single source of
 * truth: the palette shows it and registers it, so the two can't drift.
 */
export interface Command {
  readonly id: string;
  readonly label: string;
  readonly group: "Actions" | "Chats";
  readonly icon: ComponentType<{ className?: string }>;
  readonly hotkey?: Hotkey;
  readonly run: () => void;
}

/** Everything the user can do from anywhere, in palette order. */
export function useCommands(): ReadonlyArray<Command> {
  const navigate = useNavigate();
  const chat = useMatch({ from: "/chat", shouldThrow: false });
  const threads = chat?.loaderData ?? [];

  return [
    {
      id: "chat.new",
      label: "New chat",
      group: "Actions",
      icon: ComposeIcon,
      hotkey: "Mod+Shift+O",
      run: () => void navigate({ to: "/chat" }),
    },
    ...threads.map((thread): Command => ({
      id: `chat.open.${thread.id}`,
      label:
        thread.title ??
        `Chat · ${new Date(thread.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`,
      group: "Chats",
      icon: ChatIcon,
      run: () => void navigate({ to: "/chat/$threadId", params: { threadId: thread.id } }),
    })),
  ];
}
