import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

type Point = { name: string; amount: number; exact: string }
export default function Charts({ daily, categories }: { daily: Point[]; categories: Point[] }) {
  return <div className="chart-grid">{[{ title: 'Évolution quotidienne', rows: daily }, { title: 'Répartition par catégorie', rows: categories }].map(chart => <section className="panel" key={chart.title}><h2>{chart.title}</h2><div className="chart-box" role="img" aria-label={`${chart.title}. Les montants exacts sont disponibles dans le tableau sous les graphiques.`}>
    <ResponsiveContainer width="100%" height="100%"><BarChart data={chart.rows} margin={{ top: 16, right: 12, left: 0, bottom: 16 }}><CartesianGrid vertical={false} stroke="#e0e5da" /><XAxis dataKey="name" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 10 }} width={65} tickFormatter={(value: number) => new Intl.NumberFormat('fr', { notation: 'compact' }).format(value)} /><Tooltip formatter={(_value, _name, item) => [String((item.payload as Point).exact), 'Dépenses']} /><Bar dataKey="amount" fill="#315d49" radius={[5, 5, 0, 0]} isAnimationActive={false} /></BarChart></ResponsiveContainer>
    </div></section>)}</div>
}
