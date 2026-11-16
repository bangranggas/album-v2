import type { ReactNode } from "react";

import { MAX_SUMMARY_WORDS } from "@/lib/validation";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
      <div className="mt-3 flex flex-col gap-3 text-sm text-slate-600 dark:text-slate-400">
        {children}
      </div>
    </section>
  );
}

function Code({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs leading-relaxed text-slate-100">
      <code>{children}</code>
    </pre>
  );
}

const COMMANDS: readonly { command: string; does: string }[] = [
  { command: "search [text] [--domain D] [--album ID] [--no-album] [--fav] [--limit N] [--offset N]", does: "Find links. Matches title, URL and summary. Add --private --passcode for the private space." },
  { command: "show ID", does: "Everything about one link: URL, thumbnail, summary." },
  { command: "add URL [--title T] [--thumb U] [--summary S]", does: "Save a link, or update it if the URL is already saved. Only the fields you pass change." },
  { command: "edit ID [--title] [--url] [--thumb] [--summary] [--fav | --unfav]", does: "Edit a link. --summary \"\" clears the summary." },
  { command: "delete ID", does: "Preview only. Nothing is deleted; it prints the title, URL and a token." },
  { command: "delete ID --confirm TOKEN", does: "Delete for real, after you said yes." },
  { command: "albums / album-new NAME", does: "List albums with counts / create one." },
  { command: "file ALBUM_ID ID [ID...]", does: "Put many links into one album at once (up to 200)." },
];

const PROMPTS: readonly string[] = [
  "Find my saved links about hotels in Bali.",
  "Save https://example.com/article and add a short summary.",
  "Which of my links are not in any album yet? Group them and propose albums.",
  "Give the link about “Lofi Beats” a summary of at most 20 words.",
  "Delete the link about the old Next.js tutorial.",
  "Look in my private space for “Finance Tracker” — the passcode is …",
];

const TROUBLESHOOTING: readonly { code: string; meaning: string }[] = [
  { code: "401 UNAUTHORIZED", meaning: "LC_AGENT_KEY is missing or does not match AGENT_API_KEY on the server." },
  { code: "403 PASSCODE_REQUIRED", meaning: "The private space was asked for with a wrong passcode. Ask the owner again." },
  { code: "404 NOT_FOUND", meaning: "No such link or album — or it is private and no passcode was sent." },
  { code: "409 CONFIRMATION_REQUIRED", meaning: "Not an error: a delete is waiting for the owner's yes. Show the preview." },
  { code: "409 CONFLICT", meaning: "Duplicate album name, a URL already saved elsewhere, or a URL change that would cross the public/private line." },
  { code: "503 UNCONFIGURED", meaning: "AGENT_API_KEY (or LOCKED_PASSCODE, for the private space) is not set on the server." },
];

/**
 * How to use this app from Hermes Agent. A pure component: it takes the address of
 * this deployment as a prop and reads nothing from the environment, so it can never
 * print a secret, and it renders the same way in a test as in the app.
 */
export function HermesGuide({ baseUrl }: { baseUrl: string }) {
  return (
    <div className="flex flex-col gap-4">
      <Section title="What this does">
        <p>
          Hermes Agent can manage your saved links through conversation: search them, save new
          ones, edit any field, write a short summary, sort loose links into albums, and delete
          with your confirmation. It talks to this app through a small command-line tool, so it
          stays cheap in tokens.
        </p>
      </Section>

      <Section title="1. Set it up (once)">
        <ol className="list-decimal space-y-2 pl-5">
          <li>
            In your hosting settings (Vercel) add an environment variable <code>AGENT_API_KEY</code>{" "}
            with a long random value, then redeploy. Locally, put it in <code>.env.local</code>.
          </li>
          <li>
            Copy the folder <code>agent-skill/link-collector</code> from the project into
            Hermes&apos; skills folder (for example <code>~/.hermes/skills/</code> — see
            Hermes&apos; documentation for the exact place). It holds <code>SKILL.md</code>,
            the instructions Hermes reads, and <code>lc.py</code>, the tool it runs.
          </li>
          <li>
            Give Hermes these two environment variables, on the machine it runs on. The key is
            the same value as <code>AGENT_API_KEY</code>; it is never shown here.
          </li>
        </ol>
        <Code>{`export LC_BASE_URL=${baseUrl}\nexport LC_AGENT_KEY=<the value of AGENT_API_KEY>`}</Code>
        <ol className="list-decimal space-y-2 pl-5" start={4}>
          <li>
            Test it from that machine. You should see your newest links:
          </li>
        </ol>
        <Code>{"cd <skills folder>/link-collector\npython lc.py search --limit 3"}</Code>
        <p>It needs Python 3 and nothing else: there is nothing to install.</p>
      </Section>

      <Section title="2. Things you can ask Hermes">
        <ul className="list-disc space-y-1 pl-5">
          {PROMPTS.map((prompt) => (
            <li key={prompt}>{prompt}</li>
          ))}
        </ul>
      </Section>

      <Section title="3. The rules Hermes follows">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Public by default.</strong> Hermes only sees the links on the main page. The
            private space (the locked area) stays closed.
          </li>
          <li>
            <strong>Private needs your passcode, every time.</strong> When you want Hermes to look
            at or change anything private, tell it the passcode in that message. It uses the
            passcode for that one request and never stores, saves or remembers it; next time it
            asks again. Keep in mind the passcode is visible in the chat you type it into.
          </li>
          <li>
            <strong>Deleting always asks first.</strong> Hermes first gets a preview (title and
            URL) and shows it to you. Nothing is deleted until you say yes; only then does it
            send the confirmation token, which expires after 5 minutes and stops working if the
            link was edited in the meantime. The server enforces this, not just Hermes.
          </li>
          <li>
            <strong>Summaries are at most {MAX_SUMMARY_WORDS} words.</strong> Optional, and Hermes
            should only write one from what it actually knows about the page.
          </li>
        </ul>
      </Section>

      <Section title="4. Commands (what Hermes runs)">
        <p>
          You normally never type these; they are here so you can see what Hermes does or try them
          yourself. Run them as <code>python lc.py &lt;command&gt;</code>.
        </p>
        <dl className="flex flex-col gap-3">
          {COMMANDS.map((item) => (
            <div key={item.command}>
              <dt className="font-mono text-xs text-slate-900 dark:text-slate-100">{item.command}</dt>
              <dd>{item.does}</dd>
            </div>
          ))}
        </dl>
        <Code>{"python lc.py search --no-album --limit 50\npython lc.py search --private --passcode <passcode>\npython lc.py delete <id>\npython lc.py delete <id> --confirm <token>"}</Code>
      </Section>

      <Section title="5. When something goes wrong">
        <dl className="flex flex-col gap-3">
          {TROUBLESHOOTING.map((item) => (
            <div key={item.code}>
              <dt className="font-mono text-xs text-slate-900 dark:text-slate-100">{item.code}</dt>
              <dd>{item.meaning}</dd>
            </div>
          ))}
        </dl>
      </Section>
    </div>
  );
}
