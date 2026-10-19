import React, { useMemo } from 'react'
import type { Orcamento, ItemOrcamento } from '../../types'
import { isCartao } from '../../types'
import { formatBRL } from '../../utils/formatters'

const secoesDe = (o: Orcamento): ItemOrcamento[] =>
  [...o.operacaoEstrutura, ...o.equipe, ...o.atracao, ...o.abBebidas, ...o.extras]

// Custo real por item (é um painel de CUSTOS):
// - "Pago (Comissão)": Total Pago zerado → usa o valor que a comissão bancou.
// - Pago/cartão: usa o Total Pago REAL. Se a Alliance não pagou (0), o custo é 0 — ex.: item
//   de margem cobrado do cliente (a margem aparece na BV, não como custo pago aqui).
// - Contratado/Pendente: ainda não pago → usa o pago se houver, senão o orçado (expectativa).
function valorEfetivo(i: ItemOrcamento): number {
  if (i.status === 'PAGO_COMISSAO') return i.valorPassadoCliente || i.totalOrcado
  if (i.status === 'PAGO' || isCartao(i.status)) return i.totalPagoReal
  return i.totalPagoReal > 0 ? i.totalPagoReal : i.totalOrcado
}

// Cartão dobra em "Pago", então os buckets do painel são só estes 4.
type BucketKey = 'PENDENTE' | 'CONTRATADO' | 'PAGO' | 'PAGO_COMISSAO'
const BUCKETS: { key: BucketKey; label: string; cor: string; bg: string }[] = [
  { key: 'PAGO',          label: 'Pago',            cor: '#34d399', bg: 'bg-success' },
  { key: 'CONTRATADO',    label: 'Contratado',      cor: '#60a5fa', bg: 'bg-blue-400' },
  { key: 'PENDENTE',      label: 'Pendente',        cor: '#fbbf24', bg: 'bg-warning' },
  { key: 'PAGO_COMISSAO', label: 'Pago (Comissão)', cor: '#c084fc', bg: 'bg-purple-400' },
]

export const PainelStatusCustos: React.FC<{ orc: Orcamento }> = ({ orc }) => {
  const r = useMemo(() => {
    const acc: Record<BucketKey, { valor: number; n: number }> = {
      PENDENTE: { valor: 0, n: 0 }, CONTRATADO: { valor: 0, n: 0 },
      PAGO: { valor: 0, n: 0 }, PAGO_COMISSAO: { valor: 0, n: 0 },
    }
    for (const i of secoesDe(orc)) {
      const v = valorEfetivo(i)
      if (v <= 0) continue // ignora linhas vazias / sem valor
      // Cartão é pago (dinheiro da Alliance) → entra no bucket Pago; detalhe por cartão vai no card de Cartões.
      const key: BucketKey = isCartao(i.status) ? 'PAGO' : (i.status as BucketKey)
      const b = acc[key] ?? acc.PENDENTE // status legado/inesperado cai em Pendente
      b.valor += v
      b.n += 1
    }
    const total = BUCKETS.reduce((s, b) => s + acc[b.key].valor, 0)
    return { acc, total }
  }, [orc])

  if (r.total === 0) return null

  const visiveis = BUCKETS.filter(b => r.acc[b.key].n > 0)

  return (
    <div className="bg-surface-2 border border-bordercol rounded-card p-5 mt-6">
      <h3 className="text-white font-bold text-base mb-1 flex items-center gap-2">
        <span className="w-1 h-5 bg-accent rounded-full inline-block" />
        Status dos Custos
      </h3>
      <p className="text-muted text-[11px] mb-4">Valor efetivo dos itens (pago real, senão orçado) por situação de pagamento.</p>

      {/* Barra empilhada */}
      <div className="flex h-3 w-full rounded-full overflow-hidden bg-white/5 mb-4">
        {BUCKETS.map(b => {
          const pct = r.total > 0 ? (r.acc[b.key].valor / r.total) * 100 : 0
          if (pct <= 0) return null
          return (
            <div key={b.key} className={b.bg} style={{ width: `${pct}%` }}
              title={`${b.label}: ${formatBRL(r.acc[b.key].valor)}`} />
          )
        })}
      </div>

      {/* Valores por situação */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {visiveis.map(b => {
          const { valor, n } = r.acc[b.key]
          const pct = r.total > 0 ? (valor / r.total) * 100 : 0
          return (
            <div key={b.key} className="rounded-lg border border-bordercol/50 p-3">
              <p className="text-[11px] text-muted flex items-center gap-1.5 mb-1">
                <span className="w-2.5 h-2.5 rounded-sm inline-block shrink-0" style={{ background: b.cor }} /> {b.label}
              </p>
              <p className="text-lg font-bold text-white tabular-nums">{formatBRL(valor)}</p>
              <p className="text-[11px] text-muted">{pct.toFixed(0)}% · {n} {n === 1 ? 'item' : 'itens'}</p>
            </div>
          )
        })}
      </div>
    </div>
  )
}
