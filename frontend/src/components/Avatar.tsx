import { useEffect, useState } from "react";

const initialsOf = (name: string) =>
  name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";

type Props = { name: string; url?: string | null; size?: number; className?: string };

/** Profile photo, or the person's initials when there is no photo (or it fails to load). */
export default function Avatar({ name, url, size = 40, className = "" }: Props) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);

  if (url && !failed) {
    return (
      <img
        src={url}
        alt=""
        width={size}
        height={size}
        onError={() => setFailed(true)}
        style={{ width: size, height: size }}
        className={`shrink-0 rounded-full object-cover ${className}`}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
      className={`grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-sun-400 to-coral-400 font-bold text-plum-900 ${className}`}
    >
      {initialsOf(name)}
    </span>
  );
}