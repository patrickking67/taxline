// llms.txt — a plain-text map of the site for AI assistants (llmstxt.org).
import type { APIRoute } from 'astro';
import { absolute } from '../lib/url';
import { insights } from '../lib/content/insights';

export const GET: APIRoute = ({ site }) => {
  const a = (p: string) => absolute(p, site);
  const body = `# Taxline

> Agentic tax operations. Five AI agents (Relay intake, Lens extraction, Atlas research, Ledger workpapers, Sentry compliance) work behind an orchestrator. Every field carries a confidence score and a citation; fields under 0.85 confidence route to a person, and a human approves before any output ships. Taxline does not file autonomously and does not train on client data.

## Free tax calculators (tax year 2026, figures from IRS Rev. Proc. 2025-32)

- [Federal income tax calculator](${a('tools/income-tax/')}): Form 1040 estimate with brackets, capital gains, QBI, child tax credit, SE tax, NIIT, and a line-by-line trace. Accepts a plain-English description; each extracted field carries a confidence and an evidence quote checked in code before the user approves it.
- [Self-employment tax calculator](${a('tools/self-employment-tax/')}): Schedule SE with the $184,500 wage base and Additional Medicare.
- [Estimated tax calculator](${a('tools/estimated-tax/')}): §6654 safe harbor (90% / 100% / 110%) and the four 1040-ES installments.
- [S corporation election calculator](${a('tools/s-corp/')}): sole proprietor vs. S corp on the same profit, with payroll FICA, QBI, overhead, and a salary sweep.
- [Depreciation calculator](${a('tools/depreciation/')}): §179, bonus, and MACRS schedules with tax-shield present value.
- [Firm ROI calculator](${a('tools/roi/')}): hours returned, payback, NPV, and IRR for a tax practice.

## Product

- [Product](${a('product/')}): the console surfaces.
- [Agents](${a('agents/')}): the fleet and the orchestrator.
- [Methodology](${a('methodology/')}): how the engine computes, rounds, and cites; confidence routing math.
- [Insights](${a('insights/')}): guides on 2026 tax figures and planning, authored in an EmDash CMS.
${insights.map((p) => `  - [${p.title}](${a(`insights/${p.slug}/`)}): ${p.excerpt}`).join('\n')}
- [Pricing](${a('pricing/')})
- [Security](${a('security/')})
- [Docs](${a('docs/')})
`;
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
