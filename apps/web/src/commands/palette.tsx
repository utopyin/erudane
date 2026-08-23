import { formatForDisplay, useHotkey, useHotkeys } from "@tanstack/react-hotkeys";
import { useState } from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@erudane/ui/command";
import { type Command, useCommands } from "./index";

const GROUPS: ReadonlyArray<Command["group"]> = ["Actions", "Chats"];

/** ⌘K palette. Mounted once at the root; hotkeys stay live while it is closed. */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const commands = useCommands();

  useHotkey("Mod+K", () => setOpen((value) => !value));
  useHotkeys(
    commands
      .filter((command) => command.hotkey !== undefined)
      .map((command) => ({
        hotkey: command.hotkey!,
        callback: () => {
          setOpen(false);
          command.run();
        },
      })),
  );

  const select = (command: Command) => {
    setOpen(false);
    command.run();
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Type a command or search…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        {GROUPS.map((group) => {
          const items = commands.filter((command) => command.group === group);
          if (items.length === 0) return null;
          return (
            <CommandGroup key={group} heading={group}>
              {items.map((command) => (
                <CommandItem
                  key={command.id}
                  value={command.id}
                  keywords={[command.label]}
                  onSelect={() => select(command)}
                >
                  <command.icon className="text-muted-foreground" />
                  {command.label}
                  {command.hotkey && (
                    <CommandShortcut>{formatForDisplay(command.hotkey)}</CommandShortcut>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          );
        })}
      </CommandList>
    </CommandDialog>
  );
}
