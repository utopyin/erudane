import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col items-start justify-center gap-4 px-4">
      <h1 className="font-heading text-3xl font-semibold">Erudane</h1>
      <p className="text-muted-foreground">
        A learning platform that empowers you to learn anything.
      </p>
      <Button render={<Link to="/chat" />}>Open chat</Button>
    </main>
  );
}
