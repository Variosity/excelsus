/**
 * Gemini's replies are written for the transcript (markdown reads fine
 * there), but that same text goes straight to Piper for TTS. Piper has no
 * markdown awareness -- "**Noland's Roofing**" gets synthesized with the
 * asterisks mangled into the speech instead of silently skipped, and list
 * replies bloat with formatting characters right when you want them
 * smallest (longer text = more synthesis work = more memory pressure on a
 * resource-constrained instance).
 */
function stripMarkdownForSpeech(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1') // **bold**
    .replace(/\*(.*?)\*/g, '$1')     // *italic* / leftover bullet asterisks
    .replace(/^[-*]\s+/gm, '')       // leading "- " / "* " bullet markers
    .replace(/`{1,3}([^`]*)`{1,3}/g, '$1') // `code`
    .replace(/#{1,6}\s*/g, '')       // # headers
    .replace(/\n{2,}/g, '. ')        // paragraph breaks -> spoken pause
    .replace(/\n/g, ', ')            // line breaks -> softer pause
    .replace(/\s{2,}/g, ' ')
    .trim();
}

module.exports = { stripMarkdownForSpeech };
