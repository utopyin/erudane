import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return (
    <main>
      <h1>Welcome to Erudane</h1>
      <p>
        Edit <code>src/routes/index.tsx</code> to get started.
      </p>
    </main>
  );
}
