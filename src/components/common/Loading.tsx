import DialLogo from "../DialLogo";

export function Loading({ what }: { what: string }) {
  return (
    <div className="loading" role="status" aria-live="polite">
      <DialLogo className="loadinglogo" label="" spinning />
      <p className="loadingtext">{what}</p>
    </div>
  );
}
