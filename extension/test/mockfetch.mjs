// Canned responses for the scholarly APIs, so the search pipeline can be tested without a network.
export const PAPERS = [
  { paperId: "a1", title: "Knowledge graphs for fault diagnosis in industrial maintenance: a systematic review", year: 2026, venue: "Expert Systems with Applications", citationCount: 120, externalIds: { DOI: "10.1000/kg.review" }, authors: [{ name: "Rui Kang" }], isOpenAccess: true,
    abstract: "We review how knowledge graphs support fault diagnosis and maintenance decisions in industrial settings, and how knowledge is shared and reused." },
  { paperId: "a2", title: "Integrating operational data and engineering knowledge for maintenance decision support", year: 2021, venue: "Computers in Industry", citationCount: 40, externalIds: { DOI: "10.1000/integ" }, authors: [{ name: "Ana Pereira" }], isOpenAccess: false,
    abstract: "Operational data and engineering knowledge are combined so that maintenance decisions can be supported by a knowledge graph and diagnosis rules." },
  { paperId: "a3", title: "Deep convolutional networks for image classification of domestic cats", year: 2019, venue: "CVPR", citationCount: 9000, externalIds: { DOI: "10.1000/cats" }, authors: [{ name: "Cy Cat" }], isOpenAccess: true,
    abstract: "We train convolutional networks to classify images of cats and dogs." },
  { paperId: "a4", title: "Garden maintenance schedules in urban parks", year: 2018, venue: "Urban Greening", citationCount: 12, externalIds: { DOI: "10.1000/garden" }, authors: [{ name: "Gil Garden" }], isOpenAccess: false,
    abstract: "Maintenance of gardens and lawns in city parks, with schedules for pruning." },
  { paperId: "a5", title: "Triage at scale", year: 2020, venue: "Journal of Examples", citationCount: 30, externalIds: { DOI: "10.1000/example.1" }, authors: [{ name: "Anna Smith" }, { name: "Bo Lee" }], isOpenAccess: false,
    abstract: "Automated triage knowledge graphs for maintenance decisions in hospitals." },
  { paperId: "a6", title: "Active learning for maintenance knowledge capture from operators", year: 2024, venue: "Journal of Quality in Maintenance Engineering", citationCount: 15, externalIds: { DOI: "10.1000/al.cap" }, authors: [{ name: "Lena Ortiz" }], isOpenAccess: false,
    abstract: "Operators' feedback is captured as maintenance knowledge and reviewed by engineers before it changes procedures." },
];
export const calls = [];
export function installMockFetch() {
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url); calls.push(u);
    const json = (o, status = 200) => ({ status, ok: status < 400, headers: { get: () => null }, arrayBuffer: async () => Buffer.from(JSON.stringify(o)) });
    const text = (t) => ({ status: 200, ok: true, headers: { get: () => null }, arrayBuffer: async () => Buffer.from(t) });
    if (u.includes("api.semanticscholar.org/graph/v1/paper/search")) return json({ total: PAPERS.length, data: PAPERS });
    if (u.includes("api.semanticscholar.org/graph/v1/paper/batch")) return json([]);
    if (u.includes("doi.org/")) { const doi = decodeURIComponent(u.split("doi.org/")[1]); const p = PAPERS.find((x) => x.externalIds.DOI === doi); return p ? text(`@article{x, title={${p.title}}, author={${p.authors.map((a) => a.name.split(" ").reverse().join(", ")).join(" and ")}}, year={${p.year}}, journal={${p.venue}}}`) : json({}, 404); }
    if (u.includes("api.openalex.org")) return json({ results: [], meta: { count: 0 } });
    return json({}, 404);
  };
}
