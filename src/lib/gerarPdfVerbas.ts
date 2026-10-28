import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { formatBRL } from '../utils/formatters'

// PDF da aba Verbas: o que está na tela (filtros aplicados), por categoria e item, com o detalhe por projeto.
// Mesmo padrão visual dos outros PDFs do sistema (jsPDF + autotable, A4 paisagem).

export type MetricaPdf = 'orcado' | 'contratado' | 'comparar'

export interface ProjetoLinhaPdf { nome: string; local: string; fornecedor: string; o: number; c: number }
export interface ItemPdf { item: string; sub: string; o: number; c: number; projetos: ProjetoLinhaPdf[] }
export interface CategoriaPdf { nome: string; o: number; c: number; itens: ItemPdf[] }

export interface DadosPdfVerbas {
  metrica: MetricaPdf
  filtros: string[]
  resumo: { orc: number; contr: number; nItens: number; nProj: number; nContr: number; dif: number }
  categorias: CategoriaPdf[]
}

type Cor = [number, number, number]
const HDR_BG: Cor = [10, 10, 10]
const AZUL: Cor = [37, 99, 235]
const VERDE: Cor = [4, 120, 87]
const CINZA: Cor = [110, 118, 130]
const FUNDO_CAT: Cor = [226, 232, 240]
const FUNDO_ITEM: Cor = [243, 245, 249]

// O Intl usa espaço não separável ("R$ 1.234,56"), que a fonte padrão do PDF não desenha direito.
const brl = (v: number) => formatBRL(v).replace(/\s+/g, ' ')

export function gerarPdfVerbas(d: DadosPdfVerbas) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const pw = doc.internal.pageSize.getWidth()
  const ph = doc.internal.pageSize.getHeight()
  const mostraO = d.metrica !== 'contratado'
  const mostraC = d.metrica !== 'orcado'

  // Cabeçalho
  doc.setFillColor(...HDR_BG)
  doc.rect(0, 0, pw, 22, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.text('Alliance — Verbas', 12, 10)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  const leitura = d.metrica === 'orcado' ? 'Orçado' : d.metrica === 'contratado' ? 'Contratado' : 'Orçado e contratado'
  doc.text(`${leitura} · ${d.resumo.nProj} projeto(s) · ${d.resumo.nItens} linhas`, 12, 17)
  doc.setTextColor(170, 170, 170)
  doc.text(`Emitido em ${new Date().toLocaleDateString('pt-BR')}`, pw - 10, 12, { align: 'right' })
  doc.setTextColor(0, 0, 0)

  let y = 29
  // Filtros aplicados
  doc.setFontSize(8.5)
  doc.setTextColor(...CINZA)
  const textoFiltros = d.filtros.length ? `Filtros: ${d.filtros.join('  ·  ')}` : 'Filtros: nenhum (todos os projetos e itens)'
  const linhasFiltros = doc.splitTextToSize(textoFiltros, pw - 24) as string[]
  doc.text(linhasFiltros, 12, y)
  y += linhasFiltros.length * 4 + 2
  doc.setTextColor(0, 0, 0)

  // Resumo
  const cards: { rotulo: string; valor: string; cor: Cor }[] = []
  if (mostraO) cards.push({ rotulo: 'ORÇADO', valor: brl(d.resumo.orc), cor: AZUL })
  if (mostraC) cards.push({ rotulo: 'CONTRATADO', valor: brl(d.resumo.contr), cor: VERDE })
  if (mostraO && mostraC && d.resumo.nContr > 0) {
    cards.push({
      rotulo: d.resumo.dif >= 0 ? 'ABAIXO DO ORÇADO (ITENS FECHADOS)' : 'ACIMA DO ORÇADO (ITENS FECHADOS)',
      valor: brl(Math.abs(d.resumo.dif)),
      cor: d.resumo.dif >= 0 ? VERDE : [194, 65, 12],
    })
  }
  const largCard = Math.min(82, (pw - 24 - (cards.length - 1) * 4) / Math.max(cards.length, 1))
  cards.forEach((c, i) => {
    const x = 12 + i * (largCard + 4)
    doc.setDrawColor(...c.cor)
    doc.setLineWidth(0.6)
    doc.line(x, y, x + largCard, y)
    doc.setFontSize(7)
    doc.setTextColor(...CINZA)
    doc.setFont('helvetica', 'bold')
    doc.text(c.rotulo, x, y + 4)
    doc.setFontSize(12)
    doc.setTextColor(...c.cor)
    doc.text(c.valor, x, y + 10)
  })
  doc.setTextColor(0, 0, 0)
  doc.setFont('helvetica', 'normal')
  y += 16

  const cabecalhoCols = ['Item / Projeto', 'Local', 'Fornecedor']
  if (mostraO) cabecalhoCols.push('Orçado')
  if (mostraC) cabecalhoCols.push('Contratado')
  const colEstilos: Record<number, { halign: 'right'; cellWidth: number }> = {}
  let idx = 3
  if (mostraO) { colEstilos[idx++] = { halign: 'right', cellWidth: 34 } }
  if (mostraC) { colEstilos[idx++] = { halign: 'right', cellWidth: 34 } }

  const valoresCel = (o: number, c: number, estilo: object) => {
    const cel: object[] = []
    if (mostraO) cel.push({ content: o > 0 ? brl(o) : '—', styles: { ...estilo, textColor: AZUL } })
    if (mostraC) cel.push({ content: c > 0 ? brl(c) : 'a contratar', styles: { ...estilo, textColor: c > 0 ? VERDE : CINZA } })
    return cel
  }

  for (const cat of d.categorias) {
    const corpo: (string | object)[][] = []
    corpo.push([
      { content: cat.nome.toUpperCase(), colSpan: 3, styles: { fontStyle: 'bold', fillColor: FUNDO_CAT } },
      ...valoresCel(cat.o, cat.c, { fontStyle: 'bold', fillColor: FUNDO_CAT }),
    ])
    for (const it of cat.itens) {
      corpo.push([
        { content: `${it.item}  ·  ${it.sub}  ·  ${it.projetos.length} projeto(s)`, colSpan: 3, styles: { fontStyle: 'bold', fillColor: FUNDO_ITEM } },
        ...valoresCel(it.o, it.c, { fontStyle: 'bold', fillColor: FUNDO_ITEM }),
      ])
      for (const p of it.projetos) {
        corpo.push([
          { content: p.nome, styles: { cellPadding: { left: 6, top: 1.2, bottom: 1.2, right: 1.5 } } },
          p.local || '—',
          p.fornecedor || '—',
          ...valoresCel(p.o, p.c, {}),
        ])
      }
    }
    autoTable(doc, {
      startY: y,
      head: [cabecalhoCols],
      body: corpo as never,
      theme: 'plain',
      margin: { left: 12, right: 12, bottom: 14 },
      styles: { fontSize: 8, cellPadding: 1.5, lineColor: [226, 232, 240], lineWidth: 0.1, overflow: 'ellipsize' },
      headStyles: { fillColor: HDR_BG, textColor: [255, 255, 255], fontStyle: 'bold' },
      columnStyles: colEstilos,
      showHead: 'firstPage',
      rowPageBreak: 'avoid',
    })
    y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 6
    if (y > ph - 30) { doc.addPage(); y = 14 }
  }

  // Rodapé com paginação
  const n = doc.getNumberOfPages()
  for (let i = 1; i <= n; i++) {
    doc.setPage(i)
    doc.setFontSize(7.5)
    doc.setTextColor(...CINZA)
    doc.text(`Alliance — Verbas · página ${i} de ${n}`, pw - 12, ph - 6, { align: 'right' })
  }

  doc.save(`verbas_${new Date().toISOString().slice(0, 10)}.pdf`)
}
