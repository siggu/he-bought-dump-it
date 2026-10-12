import type { Quote } from "../../../shared/protocol";
import { num, pct, signed, trend } from "../format";

export function QuoteHeader({
  name,
  symbol,
  quote,
  live,
  badge,
}: {
  name: string;
  symbol: string;
  quote: Quote | null;
  live: boolean;
  badge?: string;
}) {
  const t = trend(quote?.change ?? 0);
  return (
    <div className="quote-header">
      <div className="quote-title">
        <h1>{name}</h1>
        <span className="muted">{symbol}</span>
        {badge && <span className="badge">{badge}</span>}
        <span className={`live-dot ${live ? "on" : ""}`} title={live ? "실시간" : "실시간 아님"}>
          {live ? "LIVE" : "지연"}
        </span>
      </div>
      {quote ? (
        <div className={`quote-price ${t}`}>
          <strong key={quote.price} className="flash">
            {num(quote.price)}
          </strong>
          <span>
            {signed(quote.change)} ({pct(quote.rate)})
          </span>
        </div>
      ) : (
        <div className="quote-price muted">시세 불러오는 중…</div>
      )}
      {quote && (
        <dl className="quote-stats">
          <div>
            <dt>시가</dt>
            <dd>{num(quote.open)}</dd>
          </div>
          <div>
            <dt>고가</dt>
            <dd className="up">{num(quote.high)}</dd>
          </div>
          <div>
            <dt>저가</dt>
            <dd className="down">{num(quote.low)}</dd>
          </div>
          <div>
            <dt>거래량</dt>
            <dd>{num(quote.volume)}</dd>
          </div>
        </dl>
      )}
    </div>
  );
}
