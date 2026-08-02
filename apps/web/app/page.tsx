import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-8 px-6 py-24 font-sans">
      <div className="flex flex-col gap-4">
        <h1 className="text-4xl font-semibold tracking-tight">TierList</h1>
        <p className="text-lg leading-relaxed text-zinc-600 dark:text-zinc-400">
          Build a tier list where the result stays data rather than a picture. Scale tiles,
          crop and draw on them, and share a link that opens fast.
        </p>
      </div>

      <div>
        <Link
          href="/editor"
          className="inline-flex h-12 items-center rounded-full bg-zinc-900 px-6 font-medium text-zinc-50 transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          Open the editor
        </Link>
      </div>

      <ul className="flex flex-col gap-2 text-zinc-600 dark:text-zinc-400">
        <li>Tiles at any size, for the whole list or one tier.</li>
        <li>Crop and annotate an image without leaving the board.</li>
        <li>Export as PNG, JPG, or the document itself as JSON.</li>
      </ul>

      <p className="text-sm text-zinc-500">
        The editor keeps one list per browser. Saving needs an API; without one, changes stay
        on the page.
      </p>
    </main>
  );
}
