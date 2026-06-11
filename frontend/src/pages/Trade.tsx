/**
 * Trade — thin UI over the Phase-17 Stage-1 trading seam (simulated, isolated).
 *
 * Place a market order against a simulated instrument; orders settle on the async
 * worker, so we refetch orders + positions shortly after placing. When the seam is
 * off (TRADING_ENABLED=false) the API returns 503 TRADING_DISABLED and we show a
 * quiet unavailable state. Money is rendered only from integer minor units.
 */
import { useEffect, useState } from "react";
import {
  userApi,
  newIdempotencyKey,
  ApiError,
  type Instrument,
  type TradeOrder,
  type TradePosition,
} from "../api/client";
import { formatMoney } from "../lib/money";
import { Empty, Loading, Badge } from "../components/ui";
import { useToast } from "../components/Toast";

function statusKind(status: string): "ok" | "warn" | "bad" | undefined {
  if (status === "settled") return "ok";
  if (status === "rejected") return "bad";
  if (status === "accepted") return "warn";
  return undefined;
}

export function Trade() {
  const toast = useToast();
  const [instruments, setInstruments] = useState<Instrument[] | null>(null);
  const [orders, setOrders] = useState<TradeOrder[]>([]);
  const [positions, setPositions] = useState<TradePosition[]>([]);
  const [disabled, setDisabled] = useState(false);

  const [symbol, setSymbol] = useState("");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [qty, setQty] = useState("1");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      const [inst, ords, pos] = await Promise.all([
        userApi.instruments(),
        userApi.tradeOrders(),
        userApi.positions(),
      ]);
      setInstruments(inst);
      setOrders(ords);
      setPositions(pos);
      if (inst.length && !symbol) setSymbol(inst[0].symbol);
    } catch (e) {
      if (e instanceof ApiError && e.code === "TRADING_DISABLED") setDisabled(true);
      setInstruments([]);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function place() {
    if (!symbol || busy) return;
    const n = Number(qty);
    if (!Number.isInteger(n) || n <= 0) {
      toast.show("Quantity must be a positive whole number", "bad");
      return;
    }
    setBusy(true);
    try {
      await userApi.placeTrade({ symbol, side, type: "market", qtyBase: String(n) }, newIdempotencyKey());
      toast.show(`${side === "buy" ? "Buy" : "Sell"} order placed — settling…`);
      // Settlement is async; give the worker a moment, then refetch.
      setTimeout(refresh, 600);
    } catch (e) {
      if (e instanceof ApiError && e.code === "TRADING_DISABLED") {
        setDisabled(true);
      } else {
        toast.show(e instanceof ApiError ? e.message : "Order failed", "bad");
      }
    } finally {
      setBusy(false);
    }
  }

  if (instruments === null) return <Loading />;

  if (disabled) {
    return (
      <div className="page stack lg">
        <div>
          <h1>Trade</h1>
          <p className="muted small" style={{ margin: 0 }}>Equities & crypto (simulated).</p>
        </div>
        <Empty>
          Trading is currently unavailable. This is the Phase-17 Stage-1 seam — enable it with
          <code> TRADING_ENABLED=true</code> on the backend (simulated broker only).
        </Empty>
      </div>
    );
  }

  const selected = instruments.find((i) => i.symbol === symbol);

  return (
    <div className="page stack lg">
      <div>
        <h1>Trade</h1>
        <p className="muted small" style={{ margin: 0 }}>Equities & crypto — simulated, settles on the ledger.</p>
      </div>

      {/* Order ticket */}
      <div className="card stack">
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <select value={symbol} onChange={(e) => setSymbol(e.target.value)} aria-label="Instrument">
            {instruments.map((i) => (
              <option key={i.symbol} value={i.symbol}>
                {i.symbol} · {i.displayName}
              </option>
            ))}
          </select>
          <select value={side} onChange={(e) => setSide(e.target.value as "buy" | "sell")} aria-label="Side">
            <option value="buy">Buy</option>
            <option value="sell">Sell</option>
          </select>
          <input
            type="number"
            min={1}
            step={1}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            aria-label="Quantity"
            style={{ width: 90 }}
          />
          <button onClick={place} disabled={busy || !symbol}>
            {busy ? "Placing…" : `${side === "buy" ? "Buy" : "Sell"} ${qty || ""}`}
          </button>
        </div>
        {selected && (
          <p className="muted small" style={{ margin: 0 }}>
            Mark: {formatMoney(selected.lastPriceMinor, selected.currency)} / unit · market order
          </p>
        )}
      </div>

      {/* Positions */}
      <div className="stack sm">
        <h2>Positions</h2>
        {positions.length === 0 ? (
          <Empty>No open positions.</Empty>
        ) : (
          <div className="list">
            {positions.map((p) => (
              <div key={p.symbol} className="list-row">
                <span>{p.symbol}</span>
                <span className="tnum">{p.qtyBase}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent orders */}
      <div className="stack sm">
        <h2>Recent orders</h2>
        {orders.length === 0 ? (
          <Empty>No orders yet.</Empty>
        ) : (
          <div className="list">
            {orders.map((o) => (
              <div key={o.id} className="list-row">
                <span>
                  {o.side === "buy" ? "Buy" : "Sell"} {o.qtyBase} {o.symbol}
                </span>
                <span className="row" style={{ gap: 8 }}>
                  {o.status === "rejected" && o.rejectReason && (
                    <span className="muted micro">{o.rejectReason}</span>
                  )}
                  <Badge kind={statusKind(o.status)}>{o.status}</Badge>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
