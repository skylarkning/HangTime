/** Renders `text`, wrapping the first occurrence of `needle` in a highlight. */
export function Highlight({ text, needle }: { text: string; needle: string }) {
  if (!needle) {
    return <>{text}</>;
  }
  const caseInsensitive = needle.toLowerCase() === needle;
  const haystack = caseInsensitive ? text.toLowerCase() : text;
  const index = haystack.indexOf(needle);
  if (index === -1) {
    return <>{text}</>;
  }
  return (
    <>
      {text.slice(0, index)}
      <span className="highlight">{text.slice(index, index + needle.length)}</span>
      {text.slice(index + needle.length)}
    </>
  );
}
