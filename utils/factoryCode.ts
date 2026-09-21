// New_SKU_Requests stores a SKU's factory identifiers in ONE column,
// `factory_code`, as "OtherFactoryCode|ArticleNumber":
//   before the pipe -> Other Factory Item Code -> AccountingSKU in EasyEcom
//   after the pipe  -> Article Number          -> customFields in EasyEcom
//
// A value with NO pipe is the Article Number. That is what the backend
// (apiCreateSkuOnEasyEcom, setNewSkuFactoryFields_, apiUpdateSkuFields) has
// always pushed to EasyEcom for a pipe-less value, and what the vendor-shipment
// matching treats it as. The Create SKU screen used to read a pipe-less value
// as the *Other* code instead — so it showed under the wrong label, and a lone
// "Other Factory Code" was pushed to EasyEcom as the Article Number.

export interface FactoryCodeParts {
  other: string;
  article: string;
}

export function parseFactoryCode(raw: unknown): FactoryCodeParts {
  const s = String(raw ?? '').trim();
  if (!s) return { other: '', article: '' };
  const pipe = s.indexOf('|');
  if (pipe === -1) return { other: '', article: s };
  return {
    other: s.slice(0, pipe).trim(),
    // Anything after the first pipe is the article number (a stray extra pipe
    // stays inside it rather than being silently dropped).
    article: s.slice(pipe + 1).trim(),
  };
}

// Inverse of parseFactoryCode. The pipe is emitted whenever an Other code is
// present, even with an empty article number ("FC|"), because that is the only
// way to tell "Other only" apart from "Article Number only" once flattened.
export function serializeFactoryCode(other: string, article: string): string {
  const o = (other || '').trim();
  const a = (article || '').trim();
  if (o) return `${o}|${a}`;
  return a;
}
