import { money, type PaymentCase } from "./api"
import { StageChip } from "./StageChip"

export function CaseList({ cases, selected, onSelect }: { cases: PaymentCase[]; selected: string | null; onSelect: (id: string) => void }) {
	return (
		<ul className="case-list">
			{cases.map((c) => {
				const x = c.extraction.result
				const title = x?.creditorName ?? (x ? x.documentKind : c.fileName)
				return (
					<li key={c.id}>
						<button className="case-row" aria-current={selected === c.id ? "true" : undefined} onClick={() => onSelect(c.id)}>
							<span className="title">{title}</span>
							<span className="amount num">{x?.amount != null ? money(x.amount, x.currency) : ""}</span>
							<span className="sub">
								<StageChip stage={c.stage} />
								<span className="file mono">{c.fileName}</span>
							</span>
						</button>
					</li>
				)
			})}
		</ul>
	)
}
