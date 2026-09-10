"use client";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", color: "#17231e", background: "#f5f7f6" }}>
        <main role="alert" style={{ boxSizing: "border-box", maxWidth: 680, margin: "0 auto", padding: "48px 16px", overflowWrap: "anywhere" }}>
          <p style={{ fontWeight: 700, color: "#065f46" }}>Postial</p>
          <h1 style={{ fontSize: 32 }}>Something went wrong</h1>
          <p>Postial couldn’t load this page. We don’t know why yet.</p>
          <button type="button" onClick={reset} style={{ padding: "12px 20px", border: 0, borderRadius: 8, background: "#047857", color: "white", fontWeight: 700, fontSize: 16 }}>Try again</button>
          <p style={{ fontSize: 14, color: "#4d6055" }}>If this keeps happening, email <a href="mailto:info@productivity-boost.com">info@productivity-boost.com</a>{error.digest ? ` and mention reference ${error.digest.slice(0, 12)}.` : "."}</p>
        </main>
      </body>
    </html>
  );
}
