import type { BookSource } from '@core/source/bookSource';
import { useSourceCover } from '@ui/hooks/useSourceCover';

export function SourceCover({ url, title, source }: { url: string | null; title: string; source: BookSource | null }) {
  const { attach, image } = useSourceCover(url, source);
  return <div className="discover-cover" ref={attach}>
    {image ? <img src={image} alt={title} loading="lazy" /> : <span aria-hidden="true">{title.slice(0, 12)}</span>}
  </div>;
}
