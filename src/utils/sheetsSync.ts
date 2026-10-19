import type { Projeto, SecaoCusto, ItemCusto, StatusItem, StatusPagamento, TipoCusto, TAP, TipoEscola, Receitas, LinhaResumoComercial } from '../types'
import { v4 as uuid } from './uuid'


export interface SyncResult {
  secoes: SecaoCusto[]
  tap: Partial<TAP>
  receitas: Receitas
  resumoComercial: LinhaResumoComercial[]
  totalConvidadosAtual: number | null
  totalAdesoesAtual: number | null
  avisos: string[]
}

const MAPA_SECOES: Record<string, string> = {
  'custo producao': '2.1', 'custo produção': '2.1',
  'custo artistico': '2.2', 'custo artístico': '2.2',
  'custo equipe': '2.3',
  'custo bar': '2.4', 'custo bar&food': '2.4', 'custo bar food': '2.4', 'custo bar & food': '2.4',
  'custo pré-eventos': 'preevento', 'custo pre-eventos': 'preevento', 'custo pre eventos': 'preevento',
  // A aba costuma se chamar só "PRÉ-EVENTOS" (sem "custo" na frente, diferente das outras seções) —
  // sem isso, encontrarSecao() nunca reconhecia a aba e ela era pulada em silêncio.
  'pré-eventos': 'preevento', 'pre-eventos': 'preevento', 'pre eventos': 'preevento', 'pré eventos': 'preevento',
  'cerimonia religiosa': 'cerimonia', 'cerimônia religiosa': 'cerimonia',
  'custo cerimonia': 'cerimonia', 'custo cerimônia': 'cerimonia',
  'colacao de grau': 'colacao', 'colação de grau': 'colacao',
  'custo colacao': 'colacao', 'custo colação': 'colacao',
  'custos administrativos': 'admin', 'custo administrativo': 'admin',
  // Turmas de Barbacena/FAME (ex: BQ 78) têm uma aba extra "2.9 CUSTO CHURRASCO & JANTAR"
  'custo churrasco': 'churrasco', 'churrasco & jantar': 'churrasco', 'churrasco e jantar': 'churrasco',
  'jantar dancante': 'churrasco', 'jantar dançante': 'churrasco',
}

function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9& ]/g, ' ').replace(/\s+/g, ' ').trim()
}

function encontrarSecao(nomeAba: string): string | null {
  const n = norm(nomeAba)
  for (const [pattern, id] of Object.entries(MAPA_SECOES)) {
    if (n.includes(norm(pattern))) return id
  }
  return null
}

function encontrarAbaEspecial(nomeAba: string): 'tap' | 'resumo' | 'resumoComercial' | null {
  const n = norm(nomeAba)
  if (
    n === 'simulador' || n.includes('simulador de eventos') ||
    n.includes('informacoes gerais') || n.includes('informações gerais') ||
    n.includes('termo de abertura') || n.includes('termo abertura') ||
    (n === 'tap') || (n.startsWith('tap '))
  ) return 'tap'
  if (n.includes('resumo') && n.includes('custos')) return 'resumoComercial'
  if (n === 'resumo geral' || n === 'resumo' || n.includes('resumo geral')) return 'resumo'
  return null
}

function getCell(values: unknown[][], row: number, col: number): unknown {
  return (values[row] as unknown[] | undefined)?.[col] ?? null
}

function parseNum(val: unknown): number {
  if (typeof val === 'number') return isNaN(val) ? 0 : val
  if (typeof val === 'string') {
    // Remove R$, espaços, pontos de milhar, converte vírgula decimal
    const cleaned = val
      .replace(/R\$\s*/g, '')
      .replace(/\./g, '')
      .replace(',', '.')
      .replace(/[^\d.-]/g, '')
    const n = parseFloat(cleaned)
    return isNaN(n) ? 0 : n
  }
  return 0
}

function parseStr(val: unknown): string {
  if (val === null || val === undefined) return ''
  const s = String(val).trim()
  const erros = ['#ref!', '#n/a', '#value!', '#div/0!']
  if (erros.some(e => s.toLowerCase().includes(e))) return ''
  return s
}

function parseCodigo(val: unknown): string {
  if (!val && val !== 0) return ''
  if (typeof val === 'number') {
    if (val > 40000 && val < 50000) {
      const d = new Date((val - 25569) * 86400 * 1000)
      const s = d.getUTCFullYear() - 2008
      return `2.${s}.${d.getUTCMonth() + 1}.${d.getUTCDate()}`
    }
    return String(Math.round(val))
  }
  return String(val).trim()
}

function parseStatus(val: unknown): StatusItem {
  const s = String(val ?? '').toLowerCase().trim()
  if (s === 'orçar' || s === 'orcar') return 'orçar'
  if (s === 'orçando' || s === 'orcando') return 'orçando'
  if (s === 'estimado') return 'estimado'
  if (s === 'fechado') return 'fechado'
  return 'orçar'
}

function parsePgto(val: unknown): StatusPagamento {
  const s = String(val ?? '').toLowerCase().trim()
  if (s === 'pago') return 'pago'
  if (s === 'parcial') return 'parcial'
  if (s === 'em aberto') return 'em aberto'
  return 'N/A'
}

function parseTipoCusto(val: unknown): TipoCusto {
  const s = String(val ?? '').toLowerCase()
  if (s.includes('variável') || s.includes('variavel') || s.includes('var')) return 'Custo Variável'
  return 'Custo Fixo'
}

// Quando 2+ blocos da MESMA aba usam o mesmo texto na coluna Área (ex.: "2.4.6 Extras - Alimentos e Bebidas" e
// "2.4.6 Extras - Outros", ambos com Área = "Extras"), a Área dos itens passa a ser o título do bloco — senão o app
// junta os dois num grupo só. Mantido em sincronia com sync_pos.js (flag --dividir-blocos).
// LIGADA desde 16/10/2026 (decisão do Marcos: blocos separados exatamente como na planilha).
const DIVIDIR_BLOCOS = true

// O número da seção no app passa a ser o número do NOME DA ABA da planilha (ex.: aba "2.8 CUSTOS ADMINISTRATIVOS" => 2.8).
// Os templates de Médio/Fundamental numeravam Cerimônia/Colação/Administrativos como 2.5/2.6/2.7; as planilhas usam 2.6/2.7/2.8.
// Mantido em sincronia com sync_pos.js (flag --renumerar-secoes).
// LIGADA desde 16/10/2026.
const RENUMERAR_SECOES = true

function parseItens(
  values: unknown[][], _secaoNumero: string, secaoNome: string, layout: 'A' | 'B' = 'A',
): { itens: ItemCusto[], avisos: string[] } {
  const itens: ItemCusto[] = []
  const avisos: string[] = []
  const TOLERANCIA = 1.0

  // Detect header row dynamically: col 0 has a code label AND col 4 or 5 has an item label
  let inicioLeitura = 8
  for (let i = 0; i < Math.min(values.length, 20); i++) {
    const c0 = norm(parseStr(getCell(values, i, 0)))
    const c4 = norm(parseStr(getCell(values, i, 4)))
    const c5 = norm(parseStr(getCell(values, i, 5)))
    const isCodeCol  = c0 === 'cod' || c0 === 'codigo' || c0.startsWith('cod') || c0 === 'n' || c0 === 'no'
    const isItemCol4 = c4.includes('sub') || c4.includes('cat') || c4 === 'item'
    const isItemCol5 = c5 === 'item' || c5.includes('descr') || c5.includes('servic') || c5 === 'produto'
    if (isCodeCol && (isItemCol4 || isItemCol5)) {
      inicioLeitura = i + 1
      break
    }
  }

  let blocoAtual = ''
  const blocoPorItem = new Map<string, string>()
  for (let r = inicioLeitura; r < values.length; r++) {
    const get = (c: number) => getCell(values, r, c)

    const subcategoria = parseStr(get(4))
    const item = parseStr(get(5))
    if (!subcategoria && !item) {
      // linha de título de bloco: código hierárquico na col A ("2.4.6") + título na col B ("Extras - Outros")
      const c0 = parseStr(get(0)), c1 = parseStr(get(1))
      if (c0 && c1 && /^\d+(\.\d+)+$/.test(c0)) blocoAtual = c1
      continue
    }
    const codigo = parseCodigo(get(0))
    const area = parseStr(get(1))
    const moscow = parseStr(get(2))
    const tipoCusto = parseTipoCusto(get(3))
    const fornecedor = parseStr(get(6))

    // VENDIDO PELO COMERCIAL — espelho direto da planilha
    const qtdeVendida = parseNum(get(7))
    const valorUnitarioAtual = parseNum(get(8))
    const totalAtual = parseNum(get(9))           // ← lê direto da col J, não recalcula

    const valorProjetado = parseNum(get(10))       // K
    const totalProjetado = parseNum(get(11))       // L — lê direto

    // ORÇADO — espelho direto da planilha
    // Layout B deslocado -1: Qtde=M(12), VU=N(13), Total=O(14); Layout A: Qtde=N(13), VU=O(14), Total=P(15)
    const qtdeOrcada = parseNum(get(layout === 'B' ? 12 : 13))
    const valorUnitarioOrcado = parseNum(get(layout === 'B' ? 13 : 14))
    const valorOrcado = parseNum(get(layout === 'B' ? 14 : 15))

    // Aviso de inconsistência: Qtde × VU ≠ Valor Orçado na planilha
    if (valorOrcado > 0 && qtdeOrcada > 0 && valorUnitarioOrcado > 0) {
      const calculado = qtdeOrcada * valorUnitarioOrcado
      if (Math.abs(valorOrcado - calculado) > TOLERANCIA) {
        const nome = item || subcategoria
        avisos.push(`⚠️ ${secaoNome} › ${nome} — Orçado: planilha R$${valorOrcado.toFixed(2).replace('.', ',')} ≠ Qtde×VU R$${calculado.toFixed(2).replace('.', ',')}`)
      }
    }

    // CONTRATADO — espelho direto da planilha
    // Layout B deslocado -1: Qtde=Q(16), VU=R(17), Total=S(18); Layout A: Qtde=R(17), VU=S(18), Total=T(19)
    const qtdeContratada = parseNum(get(layout === 'B' ? 16 : 17))
    const valorUnitarioContratado = parseNum(get(layout === 'B' ? 17 : 18))
    const valorContratado = parseNum(get(layout === 'B' ? 18 : 19))

    // Aviso de inconsistência: Qtde × VU ≠ Valor Contratado na planilha
    if (valorContratado > 0 && qtdeContratada > 0 && valorUnitarioContratado > 0) {
      const calculado = qtdeContratada * valorUnitarioContratado
      if (Math.abs(valorContratado - calculado) > TOLERANCIA) {
        const nome = item || subcategoria
        avisos.push(`⚠️ ${secaoNome} › ${nome} — Contratado: planilha R$${valorContratado.toFixed(2).replace('.', ',')} ≠ Qtde×VU R$${calculado.toFixed(2).replace('.', ',')}`)
      }
    }

    const responsavel = parseStr(get(20))
    const status = parseStatus(get(21))
    const statusPagamento = parsePgto(get(24))
    const valorFinal = parseNum(get(26))
    const valorPago = parseNum(get(layout === 'B' ? 26 : 27))  // Layout A=AB(27) Layout B=AA(26)
    const faltaPagar = parseNum(get(28))

    const idItem = uuid()
    if (blocoAtual) blocoPorItem.set(idItem, blocoAtual)
    itens.push({
      id: idItem, codigo, area, subcategoria, item, fornecedor, tipoCusto, moscow,
      qtdeVendida, valorUnitarioAtual, totalAtual, valorProjetado, totalProjetado,
      qtdeOrcada, valorUnitarioOrcado, valorOrcado,
      qtdeContratada, valorUnitarioContratado, valorContratado,
      responsavel, status, statusPagamento,
      valorFinal, valorPago, faltaPagar,
      totalProgramado: 0, emAberto: 0, jotform: [],
    })
  }

  if (DIVIDIR_BLOCOS) {
    const blocosPorArea = new Map<string, Set<string>>()
    for (const it of itens) {
      const b = blocoPorItem.get(it.id)
      if (!b || !it.area) continue
      if (!blocosPorArea.has(it.area)) blocosPorArea.set(it.area, new Set())
      blocosPorArea.get(it.area)!.add(b)
    }
    for (const it of itens) {
      const b = blocoPorItem.get(it.id)
      if (b && it.area && (blocosPorArea.get(it.area)?.size ?? 0) > 1) it.area = b
    }
  }

  return { itens, avisos }
}

export function parseTAPFromSheet(values: unknown[][]): Partial<TAP> {
  const map = new Map<string, unknown>()

  for (let r = 0; r < values.length; r++) {
    const row = (values[r] as unknown[] | undefined) ?? []
    for (let c = 0; c < row.length; c++) {
      const label = parseStr(row[c])
      if (!label || label.length < 3) continue
      for (let d = 1; d <= 5; d++) {
        if (c + d >= row.length) break
        const val = row[c + d]
        if (val !== null && val !== undefined && String(val).trim() !== '') {
          if (!map.has(norm(label))) map.set(norm(label), val)
          break
        }
      }
    }
  }

  function get(labels: string[]): unknown {
    for (const l of labels) {
      const v = map.get(l)
      if (v !== undefined && v !== null && v !== '') return v
    }
    return undefined
  }

  let ipca = parseNum(get(['ipca a a', 'ipca aa', 'ipca a.a', 'ipca anual', 'ipca']))
  if (ipca >= 1) ipca = ipca / 100

  const parcelasNum = parseNum(get([
    'tempo de contrato meses', 'tempo de contrato (meses)', 'parcelas', 'tempo contrato meses',
  ]))

  const tempoDeFestaN = parseNum(get(['tempo de festa horas', 'tempo de festa (horas)', 'tempo de festa']))

  const tipoStr = parseStr(get(['tipo de orcamento', 'tipo orcamento', 'tipo de ensino'])).toLowerCase()
  let tipoEscola: TipoEscola = 'MEDIO'
  if (tipoStr.includes('fundamental')) tipoEscola = 'FUNDAMENTAL'
  else if (tipoStr.includes('superior') || tipoStr.includes('faculdade') || tipoStr.includes('universidade')) tipoEscola = 'SUPERIOR'

  const found: Partial<TAP> = {}

  const instituicao = parseStr(get(['instituicao de ensino', 'instituicao', 'escola']))
  if (instituicao) found.instituicao = instituicao

  const curso = parseStr(get(['curso']))
  if (curso) found.curso = curso

  const anoOrcamento = parseNum(get(['ano do orcamento', 'ano orcamento']))
  if (anoOrcamento) found.anoOrcamento = anoOrcamento

  const anoRealizacao = parseNum(get(['ano realizacao previsto', 'ano realizacao (previsto)', 'ano realizacao']))
  if (anoRealizacao) found.anoRealizacao = anoRealizacao

  if (tipoStr) found.tipoEscola = tipoEscola

  const qtdFormandos = parseNum(get(['total de alunos na turma', 'total alunos na turma', 'qtd formandos', 'formandos']))
  if (qtdFormandos) found.qtdFormandos = qtdFormandos

  const adesoesPrevistas = parseNum(get(['adesoes previstas', 'adesoes']))
  if (adesoesPrevistas) found.adesoesPrevistas = adesoesPrevistas

  const qtdConvidadosBaile = parseNum(get(['qtde de convidados previstos', 'qtde convidados previstos', 'qtd convidados baile']))
  if (qtdConvidadosBaile) found.qtdConvidadosBaile = qtdConvidadosBaile

  const modeloContrato = parseStr(get(['modelo de contrato']))
  if (modeloContrato) found.modeloContrato = modeloContrato

  const pacoteBase = String(get(['pacote base p calculo', 'pacote base para calculo', 'pacote base']) ?? '')
  if (pacoteBase) found.pacoteBase = pacoteBase

  if (tempoDeFestaN) found.tempoDeFesta = `${tempoDeFestaN}h`
  if (parcelasNum) found.parcelas = parcelasNum
  if (ipca) found.ipca = ipca

  return found
}

function parseTotalConvidados(values: unknown[][]): number | null {
  for (let r = 0; r < values.length; r++) {
    const colB = parseStr(getCell(values, r, 1))
    if (colB.toLowerCase().includes('total atual')) {
      const val = parseNum(getCell(values, r, 2))
      return val > 0 ? val : null
    }
  }
  return null
}

// "TOTAL FORMANDOS" (bloco INFORMAÇÕES) = soma dos pacotes de convite já fechados,
// ou seja, a contagem real de formandos aderidos — diferente de adesoesPrevistas
// (meta do TAP) e de totalConvidadosAtual (convidados, não formandos).
function parseTotalFormandos(values: unknown[][]): number | null {
  for (let r = 0; r < values.length; r++) {
    const colB = parseStr(getCell(values, r, 1))
    if (colB.toLowerCase().includes('total formandos')) {
      const val = parseNum(getCell(values, r, 2))
      return val > 0 ? val : null
    }
  }
  return null
}

// ACOMP. ATENDIMENTO v2 (modelo atualizado): layout em blocos numerados, então os totais são lidos pelo
// RÓTULO ("TOTAL CONVIDADOS", "TOTAL ADESÕES") e o valor é o primeiro número positivo à direita dele.
function parseTotalPorRotuloV2(values: unknown[][], rotuloNorm: string): number | null {
  for (let r = 0; r < values.length; r++) {
    const linha = (values[r] as unknown[]) ?? []
    for (let c = 0; c < Math.min(linha.length, 4); c++) {
      if (norm(parseStr(linha[c])) !== rotuloNorm) continue
      for (let k = c + 1; k < linha.length; k++) {
        const bruto = parseStr(linha[k])
        if (!bruto || /R\$/.test(bruto)) continue
        const n = parseNum(linha[k])
        if (n > 0) return n
      }
      return null
    }
  }
  return null
}
export const parseTotalConvidadosV2 = (values: unknown[][]) => parseTotalPorRotuloV2(values, 'total convidados')
export const parseTotalAdesoesV2 = (values: unknown[][]) => parseTotalPorRotuloV2(values, 'total adesoes')
export const ehAbaAcompV2 = (nomeAba: string) => /\bv2\b/.test(norm(nomeAba))
// abas de cópia/backup da ACOMP. ATENDIMENTO (ex.: "ACOMP. ATENDIMENTO_bkp_2026-07-06") nunca são lidas
export const ehAbaBackup = (nomeAba: string) => /\b(bkp|backup|copia)\b/.test(norm(nomeAba))

function parseReceitasFromResumo(values: unknown[][]): Receitas {
  // Localiza a linha de cabeçalho da tabela de receitas:
  // col A = "ITEM" E a linha contém "vendido"/"orcado" (evita falso positivo em outras linhas com "ITEM")
  let headerRow0 = -1
  for (let r = 0; r < Math.min(values.length, 50); r++) {
    const colLabel = norm(parseStr(getCell(values, r, 1))) || norm(parseStr(getCell(values, r, 0)))
    const rowJoined = ((values[r] as unknown[]) ?? []).map(c => norm(parseStr(c))).join(' ')
    if ((colLabel === 'item' || colLabel === 'receitas') && (rowJoined.includes('vendido') || rowJoined.includes('orcado'))) {
      headerRow0 = r
      break
    }
  }
  // Fallback: qualquer linha com "vendido"/"orcado" nas primeiras 50 linhas
  if (headerRow0 < 0) {
    for (let r = 0; r < Math.min(values.length, 50); r++) {
      const joined = ((values[r] as unknown[]) ?? []).map(c => norm(parseStr(c))).join(' ')
      if (joined.includes('vendido') || joined.includes('orcado')) { headerRow0 = r; break }
    }
  }

  // Defaults para layout padrão: col A=item, col B=vendido valor, col C=% rec, col D=orcado valor...
  let colVendido = 1
  let colOrcado = 3
  let colContratado = 5
  let colPago = 7
  let colFaltaPagar = 8

  if (headerRow0 >= 0 && headerRow0 + 1 < values.length) {
    const row0 = (values[headerRow0] as unknown[]) ?? []
    const row1 = (values[headerRow0 + 1] as unknown[]) ?? []

    let currentGroup = ''
    for (let c = 0; c < Math.max(row0.length, row1.length); c++) {
      const g = parseStr(row0[c] ?? null)
      const s = parseStr(row1[c] ?? null)
      if (g) currentGroup = g
      if (!currentGroup && !s) continue
      const key = s ? `${norm(currentGroup)} / ${norm(s)}` : norm(currentGroup)

      if (key.includes('vendido') && key.includes('valor') && !key.includes('conciliacao')) colVendido = c
      else if (key.includes('orcado') && key.includes('valor') && !key.includes('contratado') && !key.includes('conciliacao')) colOrcado = c
      else if (key.includes('contratado') && key.includes('valor') && !key.includes('conciliacao')) colContratado = c
      else if (key.includes('conciliacao') && key.includes('valor') && !key.includes('falta')) colPago = c
      else if (key.includes('conciliacao') && (key.includes('falta pagar') || key.includes('falta'))) colFaltaPagar = c
    }
  }

  // dataStart: logo após as duas linhas de cabeçalho (grupo + subgrupo)
  const dataStart = headerRow0 >= 0 ? headerRow0 + 2 : 0

  const parseCell = (r: number, col: number): number => {
    const v = getCell(values, r, col)
    const s = String(v ?? '').trim()
    if (!s || s === '-' || s === '—') return 0
    return parseNum(v)
  }

  const result: Receitas = {}

  for (let r = dataStart; r < values.length; r++) {
    // Tenta coluna B (1) primeiro, fallback coluna A (0)
    const rawLabel = parseStr(getCell(values, r, 1)) || parseStr(getCell(values, r, 0))
    if (!rawLabel) continue

    const ln = norm(rawLabel)
    // Linha de total — parar. O modelo padrão chama de "RECEITA BAILE"; o modelo E.S.
    // mais novo (ex: BQ 78) chama de "RECEITA TOTAL". Sem parar aqui, o parser engole as
    // linhas de custo/margem/lucro logo abaixo como se fossem receita e infla tudo.
    if (ln.includes('receita baile') || ln.startsWith('receita total')) break

    // Pular linhas de cabeçalho de seção que não são itens individuais
    if (ln === 'receitas' || ln === 'item' || ln === 'total' || ln === 'descricao') continue

    const vendido    = parseCell(r, colVendido)
    const orcado     = parseCell(r, colOrcado)
    const contratado = parseCell(r, colContratado)
    const pago       = parseCell(r, colPago)
    const faltaPagar = parseCell(r, colFaltaPagar)

    // Incluir linha mesmo com todos os valores zero (exibir R$ 0,00 em vez de omitir)

    const existing = result[rawLabel]
    if (existing) {
      result[rawLabel] = {
        vendido:    existing.vendido    + vendido,
        orcado:     existing.orcado     + orcado,
        contratado: existing.contratado + contratado,
        pago:       existing.pago       + pago,
        faltaPagar: existing.faltaPagar + faltaPagar,
      }
    } else {
      result[rawLabel] = { vendido, orcado, contratado, pago, faltaPagar }
    }
  }

  return result
}

// Lê a aba "1.1 RESUMO CUSTOS" (FEE Alliance, Imposto FEE, etc.) — colunas descobertas
// dinamicamente. Cobre tanto cabeçalho de uma linha só quanto grupo+subgrupo em duas
// linhas (ex: "Valor Previsto" numa linha, "Comercial"/"Produção" na linha de baixo —
// mesmo padrão de duas linhas que a tabela de Resumo Geral já usa).
function parseResumoComercialFromSheet(values: unknown[][]): LinhaResumoComercial[] {
  const linhas: LinhaResumoComercial[] = []

  // Âncora exige "Custos" numa célula E "comercial"/"real" em algum lugar da mesma
  // linha ou da linha seguinte — evita travar numa menção solta da palavra "Custos"
  // em outro lugar da aba, antes da tabela de verdade.
  let headerRow = -1
  let colDescricao = -1

  for (let r = 0; r < values.length; r++) {
    const row = (values[r] as unknown[]) ?? []
    let foundCustos = -1
    for (let c = 0; c < row.length; c++) {
      if (norm(parseStr(row[c])) === 'custos') { foundCustos = c; break }
    }
    if (foundCustos === -1) continue
    const nextRow = (values[r + 1] as unknown[]) ?? []
    const rowJoined = row.map((c) => norm(parseStr(c))).join(' ')
    const nextJoined = nextRow.map((c) => norm(parseStr(c))).join(' ')
    if (rowJoined.includes('comercial') || nextJoined.includes('comercial') || rowJoined.includes('real') || nextJoined.includes('real')) {
      headerRow = r
      colDescricao = foundCustos
      break
    }
  }
  if (headerRow === -1) return linhas

  let colComercial = -1, colProducao = -1, colPercentual = -1, colReal = -1
  const row0 = (values[headerRow] as unknown[]) ?? []
  const row1 = (values[headerRow + 1] as unknown[]) ?? []
  let currentGroup = ''
  for (let c = 0; c < Math.max(row0.length, row1.length); c++) {
    const g = parseStr(row0[c] ?? null)
    const s = parseStr(row1[c] ?? null)
    if (g) currentGroup = g
    const combinado = norm(`${currentGroup} ${s}`)
    const soLinha0 = norm(g)
    // Atenção: norm() remove o caractere "%" (só mantém letras/números), então a
    // comparação com "%" precisa ser feita no texto bruto, não no normalizado.
    if (combinado.includes('comercial')) colComercial = c
    else if (combinado.includes('producao')) colProducao = c
    else if (g.trim() === '%' || combinado.includes('percentual')) colPercentual = c
    else if (combinado.includes('valor real') || soLinha0 === 'real' || norm(s) === 'real') colReal = c
  }

  // Se a linha seguinte também é cabeçalho (grupo+subgrupo), os dados começam duas
  // linhas depois; senão, uma linha depois.
  const row1Norm = norm(row1.map((c) => parseStr(c)).join(' '))
  const dataStart = (row1Norm.includes('comercial') || row1Norm.includes('producao') || row1Norm.includes('real'))
    ? headerRow + 2
    : headerRow + 1

  for (let r = dataStart; r < values.length; r++) {
    const descricao = parseStr(getCell(values, r, colDescricao))
    if (!descricao) continue
    linhas.push({
      descricao,
      valorComercial: colComercial >= 0 ? parseNum(getCell(values, r, colComercial)) : 0,
      valorProducao: colProducao >= 0 ? parseNum(getCell(values, r, colProducao)) : 0,
      percentual: colPercentual >= 0 ? parseNum(getCell(values, r, colPercentual)) : 0,
      valorReal: colReal >= 0 ? parseNum(getCell(values, r, colReal)) : 0,
    })
    // A tabela real termina na linha de total "(CC) Custo Cerimonial" — abaixo dela,
    // na mesma aba, vêm outras tabelas (Sub Total, Acréscimos, Descontos, CTE, MoSCoW,
    // Custo Fixo/Variável) que não fazem parte deste quadro e não devem ser capturadas.
    if (descricao.trim().startsWith('(')) break
  }

  return linhas
}

export async function fetchSheetNames(spreadsheetId: string, accessToken: string): Promise<string[]> {
  const resp = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties.title`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  if (resp.status === 401) {
    const err = new Error('Token do Google expirado. Reconecte o Google Drive e tente novamente.')
    ;(err as Error & { tipo?: string }).tipo = 'TOKEN_EXPIRADO'
    throw err
  }
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(body.error?.message ?? `Erro ao acessar planilha (HTTP ${resp.status})`)
  }
  const meta = await resp.json() as { sheets: { properties: { title: string } }[] }
  return meta.sheets.map(s => s.properties.title)
}

export async function fetchAba(spreadsheetId: string, nomeAba: string, accessToken: string, rangeSpec?: string): Promise<unknown[][] | null> {
  const rangeParam = rangeSpec ?? nomeAba
  // FORMATTED_VALUE: espelha exatamente o que aparece na planilha (já calculado e formatado)
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(rangeParam)}?valueRenderOption=FORMATTED_VALUE`
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })

  if (resp.status === 401) {
    const err = new Error('Token do Google expirado. Reconecte o Google Drive e tente novamente.')
    ;(err as Error & { tipo?: string }).tipo = 'TOKEN_EXPIRADO'
    throw err
  }
  if (resp.status === 403) throw new Error('Sem permissão para acessar esta planilha. Verifique se ela está compartilhada com sua conta.')
  if (resp.status === 404) return null

  if (!resp.ok) {
    const body = await resp.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(body.error?.message ?? `Erro ao ler planilha (HTTP ${resp.status})`)
  }

  const data = await resp.json() as { values?: unknown[][] }
  return data.values ?? []
}

export async function lerTAPDeSheets(
  spreadsheetId: string,
  accessToken: string,
): Promise<Partial<TAP>> {
  const metaResp = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties.title`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  if (metaResp.status === 401) {
    const err = new Error('Token do Google expirado. Reconecte o Google Drive e tente novamente.')
    ;(err as Error & { tipo?: string }).tipo = 'TOKEN_EXPIRADO'
    throw err
  }
  if (metaResp.status === 403) {
    const body = await metaResp.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(body.error?.message ?? 'Acesso negado. Verifique se a planilha está compartilhada e se a Google Sheets API está ativada no Google Cloud Console.')
  }
  if (!metaResp.ok) {
    const body = await metaResp.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(body.error?.message ?? `Erro ao acessar planilha (HTTP ${metaResp.status})`)
  }

  const meta = await metaResp.json() as { sheets: { properties: { title: string } }[] }
  const sheetNames = meta.sheets.map(s => s.properties.title)

  for (const nome of sheetNames) {
    if (encontrarAbaEspecial(nome) === 'tap') {
      const values = await fetchAba(spreadsheetId, nome, accessToken)
      if (values) return parseTAPFromSheet(values)
    }
  }
  return {}
}

export async function sincronizarComSheets(
  spreadsheetId: string,
  accessToken: string,
  projeto: Projeto,
  onProgress: (msg: string) => void,
  layout: 'A' | 'B' = 'A',
): Promise<SyncResult> {
  onProgress('Lendo estrutura da planilha...')

  const metaResp = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties.title`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )

  if (metaResp.status === 401) {
    const err = new Error('Token do Google expirado. Reconecte o Google Drive e tente novamente.')
    ;(err as Error & { tipo?: string }).tipo = 'TOKEN_EXPIRADO'
    throw err
  }
  if (!metaResp.ok) {
    const body = await metaResp.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(body.error?.message ?? 'Não foi possível acessar a planilha. Verifique a URL e as permissões.')
  }

  const meta = await metaResp.json() as { sheets: { properties: { title: string } }[] }
  const sheetNames = meta.sheets.map(s => s.properties.title)

  const novasSecoes = new Map<string, ItemCusto[]>()
  const renumerar = new Map<string, string>()
  let tapParsed: Partial<TAP> = {}
  let receitasParsed: Partial<Receitas> = {}
  let resumoEncontrado = false
  let resumoComercialParsed: LinhaResumoComercial[] = []
  let totalConvidadosAtual: number | null = null
  let totalAdesoesAtual: number | null = null
  let totalConvidadosDeV2 = false
  let totalAdesoesDeV2 = false
  const avisosItens: string[] = []
  let preEventoExtra: { id: string; numero: string; nome: string; itens: ItemCusto[] } | null = null
  let churrascoExtra: { id: string; numero: string; nome: string; itens: ItemCusto[] } | null = null

  for (const nomeAba of sheetNames) {
    const nomeN = norm(nomeAba)
    if (nomeN.includes('acomp') && (nomeN.includes('atendimento') || nomeN.includes('atend'))) {
      if (ehAbaBackup(nomeAba)) continue
      onProgress(`Lendo ACOMP. Atendimento (${nomeAba})...`)
      try {
        const values = await fetchAba(spreadsheetId, nomeAba, accessToken)
        if (values) {
          // v2 (modelo atualizado) tem prioridade sobre a aba antiga; se a v2 não trouxer o total, cai na antiga
          if (ehAbaAcompV2(nomeAba)) {
            const c = parseTotalConvidadosV2(values)
            const a = parseTotalAdesoesV2(values)
            if (c != null) { totalConvidadosAtual = c; totalConvidadosDeV2 = true }
            if (a != null) { totalAdesoesAtual = a; totalAdesoesDeV2 = true }
          } else {
            const c = parseTotalConvidados(values)
            const a = parseTotalFormandos(values)
            if (!totalConvidadosDeV2) totalConvidadosAtual = c
            if (!totalAdesoesDeV2) totalAdesoesAtual = a
          }
        }
      } catch (e) {
        if ((e as Error & { tipo?: string }).tipo === 'TOKEN_EXPIRADO') throw e
        console.warn(`Erro ao ler aba "${nomeAba}":`, e)
      }
      continue
    }

    const especial = encontrarAbaEspecial(nomeAba)

    if (especial === 'tap') {
      onProgress(`Lendo TAP (${nomeAba})...`)
      try {
        const values = await fetchAba(spreadsheetId, nomeAba, accessToken)
        if (values) tapParsed = parseTAPFromSheet(values)
      } catch (e) {
        if ((e as Error & { tipo?: string }).tipo === 'TOKEN_EXPIRADO') throw e
        console.warn(`Erro ao ler aba TAP "${nomeAba}":`, e)
      }
      continue
    }

    if (especial === 'resumoComercial') {
      onProgress(`Lendo Resumo Comercial (${nomeAba})...`)
      try {
        const values = await fetchAba(spreadsheetId, nomeAba, accessToken)
        if (values) resumoComercialParsed = parseResumoComercialFromSheet(values)
      } catch (e) {
        if ((e as Error & { tipo?: string }).tipo === 'TOKEN_EXPIRADO') throw e
        console.warn(`Erro ao ler aba Resumo Comercial "${nomeAba}":`, e)
      }
      continue
    }

    if (especial === 'resumo') {
      resumoEncontrado = true
      onProgress(`Lendo Resumo Geral (${nomeAba})...`)
      try {
        const values = await fetchAba(spreadsheetId, nomeAba, accessToken, `'${nomeAba}'!A1:Z100`)
        if (values) receitasParsed = parseReceitasFromResumo(values)
      } catch (e) {
        if ((e as Error & { tipo?: string }).tipo === 'TOKEN_EXPIRADO') throw e
        console.warn(`Erro ao ler aba Resumo "${nomeAba}":`, e)
      }
      continue
    }

    const secaoId = encontrarSecao(nomeAba)
    if (!secaoId) continue

    const secaoProjeto = projeto.secoes.find(s =>
      s.numero === secaoId ||
      (secaoId === 'cerimonia' && (s.nome.toLowerCase().includes('cerimônia') || s.nome.toLowerCase().includes('cerimonia'))) ||
      (secaoId === 'colacao' && (s.nome.toLowerCase().includes('colação') || s.nome.toLowerCase().includes('colacao'))) ||
      (secaoId === 'admin' && s.nome.toLowerCase().includes('admin')) ||
      (secaoId === 'preevento' && (s.nome.toLowerCase().includes('pré-event') || s.nome.toLowerCase().includes('pre-event') || s.nome.toLowerCase().includes('pre event') || s.nome.toLowerCase().includes('pré event'))) ||
      (secaoId === 'churrasco' && (s.numero === '2.9' || s.nome.toLowerCase().includes('churrasco') || s.nome.toLowerCase().includes('jantar')))
    )
    // Seção 2.9 Churrasco & Jantar só existe em algumas turmas (Barbacena/FAME): criar dinamicamente
    if (!secaoProjeto && secaoId === 'churrasco') {
      onProgress(`Lendo CUSTO CHURRASCO & JANTAR (extra)...`)
      try {
        const values = await fetchAba(spreadsheetId, nomeAba, accessToken)
        if (values) {
          const { itens, avisos: avisosAba } = parseItens(values, '2.9', 'CUSTO CHURRASCO & JANTAR', layout)
          if (itens.length > 0) {
            churrascoExtra = { id: uuid(), numero: '2.9', nome: 'CUSTO CHURRASCO & JANTAR', itens }
          }
          avisosItens.push(...avisosAba)
        }
      } catch (e) {
        if ((e as Error & { tipo?: string }).tipo === 'TOKEN_EXPIRADO') throw e
        console.warn(`Erro ao ler aba "${nomeAba}":`, e)
      }
      continue
    }
    // Seção Pré-Eventos pode não existir em projetos EM: criar dinamicamente
    if (!secaoProjeto && secaoId === 'preevento') {
      onProgress(`Lendo CUSTO PRÉ-EVENTOS (extra)...`)
      try {
        const values = await fetchAba(spreadsheetId, nomeAba, accessToken)
        if (values) {
          const { itens, avisos: avisosAba } = parseItens(values, 'preevento', 'CUSTO PRÉ-EVENTOS', layout)
          if (itens.length > 0) {
            preEventoExtra = { id: uuid(), numero: 'preevento', nome: 'CUSTO PRÉ-EVENTOS', itens }
          }
          avisosItens.push(...avisosAba)
        }
      } catch (e) {
        if ((e as Error & { tipo?: string }).tipo === 'TOKEN_EXPIRADO') throw e
        console.warn(`Erro ao ler aba "${nomeAba}":`, e)
      }
      continue
    }

    if (!secaoProjeto) continue

    const prefixoAba = nomeAba.match(/^\s*(\d+\.\d+)\b/)?.[1]
    if (prefixoAba && prefixoAba !== secaoProjeto.numero) renumerar.set(secaoProjeto.numero, prefixoAba)

    onProgress(`Lendo ${secaoProjeto.nome} (${secaoProjeto.numero})...`)
    try {
      const values = await fetchAba(spreadsheetId, nomeAba, accessToken)
      if (values) {
        const { itens, avisos: avisosAba } = parseItens(values, secaoProjeto.numero, secaoProjeto.nome, layout)
        novasSecoes.set(secaoProjeto.numero, itens)
        avisosItens.push(...avisosAba)
      }
    } catch (e) {
      if ((e as Error & { tipo?: string }).tipo === 'TOKEN_EXPIRADO') throw e
      console.warn(`Erro ao ler aba "${nomeAba}":`, e)
    }
  }

  // Usa codigo como chave primária; fallback para subcategoria|item se código vazio.
  const chaveDoItem = (i: { codigo?: string; subcategoria: string; item: string }) =>
    i.codigo?.trim() ? i.codigo.trim() : `|${i.subcategoria}|${i.item}`

  const secoesAtualizadas = projeto.secoes.map(secao => {
    const novosItens = novasSecoes.get(secao.numero)
    if (!novosItens) return secao

    // Agrupa por chave dos dois lados (existente e novo) — só reaproveita o ID antigo
    // quando a chave for INEQUÍVOCA (exatamente 1 item de cada lado). Quando "código" está
    // vazio e o mesmo par subcategoria+item se repete em várias linhas, várias entradas
    // cairiam na mesma chave; reaproveitar cegamente colidia todas no mesmo ID (bug real,
    // encontrado em quase todo projeto sincronizado — editar uma linha aplicava a mudança
    // em todas as que compartilhavam o ID). Itens ambíguos ficam com o ID novo gerado no
    // parse em vez de arriscar juntar itens diferentes.
    const existingByChave = new Map<string, ItemCusto[]>()
    for (const item of secao.itens) {
      const chave = chaveDoItem(item)
      const arr = existingByChave.get(chave)
      if (arr) arr.push(item)
      else existingByChave.set(chave, [item])
    }

    const novosPorChave = new Map<string, number>()
    for (const novoItem of novosItens) {
      const chave = chaveDoItem(novoItem)
      novosPorChave.set(chave, (novosPorChave.get(chave) ?? 0) + 1)
    }

    // Sync sobrescreve — apenas itens lidos do sheet ficam. IDs existentes são preservados
    // para estabilidade de chaves React quando a chave é inequívoca; itens que não existem
    // mais no sheet são removidos.
    const itensFinais = novosItens.map(novoItem => {
      const chave = chaveDoItem(novoItem)
      const existentes = existingByChave.get(chave)
      const inequivoco = existentes?.length === 1 && novosPorChave.get(chave) === 1
      if (inequivoco) {
        const existente = existentes[0]
        return { ...novoItem, id: existente.id, jotform: existente.jotform }
      }
      return novoItem
    })

    return { ...secao, itens: itensFinais }
  })

  // Quando o Resumo Geral foi lido com sucesso, substitui as receitas inteiras pelo dado
  // parseado — garante que entradas obsoletas (ex: linhas de somatório de syncs antigos) sejam removidas.
  // Fallback: mantém as receitas do projeto quando a aba não foi encontrada.
  // Linhas com valor zero são preservadas (exibir R$ 0,00 em vez de omitir).
  const receitasMerged: Receitas = resumoEncontrado && Object.keys(receitasParsed).length > 0
    ? receitasParsed as Receitas
    : { ...projeto.receitas }

  const avisos: string[] = []
  if (!resumoEncontrado) {
    avisos.push("Receitas não importadas — aba 'Resumo Geral' não localizada")
  }
  avisos.push(...avisosItens)

  let secoesComNumero = secoesAtualizadas
  if (RENUMERAR_SECOES && renumerar.size > 0) {
    const tentativa = secoesAtualizadas.map(sc => (renumerar.has(sc.numero) ? { ...sc, numero: renumerar.get(sc.numero)! } : sc))
    const todosNumeros = [...tentativa, ...(preEventoExtra ? [preEventoExtra] : []), ...(churrascoExtra ? [churrascoExtra] : [])].map(sc => sc.numero)
    if (new Set(todosNumeros).size === todosNumeros.length) secoesComNumero = tentativa
  }

  const secoesFinais = [
    ...secoesComNumero,
    ...(preEventoExtra ? [preEventoExtra] : []),
    ...(churrascoExtra ? [churrascoExtra] : []),
  ]

  return {
    secoes: secoesFinais,
    tap: tapParsed,
    receitas: receitasMerged,
    resumoComercial: resumoComercialParsed.length > 0 ? resumoComercialParsed : (projeto.resumoComercial ?? []),
    totalConvidadosAtual,
    totalAdesoesAtual,
    avisos,
  }
}

export function extrairSpreadsheetId(url: string): string | null {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)
  return match?.[1] ?? null
}