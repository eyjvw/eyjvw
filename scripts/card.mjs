// Builds card.svg: the single figure on the profile README.
//
// Everything it draws comes from one GraphQL call, so the card is generated
// rather than assembled from third-party image services. Run it with a token
// in GITHUB_TOKEN; the workflow does that every 12 hours.
//
//   node scripts/card.mjs > card.svg
//   node scripts/card.mjs --fixture data.json > card.svg   (offline preview)

import { writeFileSync, readFileSync } from "node:fs";

const USER = process.env.CARD_USER ?? "eyjvw";

/* ── design tokens (vynq.dev) ─────────────────────────────────────────── */

const C = {
	bg: "#0a0a0b",
	ink: "#edede8",
	dim: "#a6a6ae",
	muted: "#9a9aa1",
	line: "#1d1d22",
	lineStrong: "#45454d",
	accent: "#2e7cf6",
};

// Geist is not available to a README renderer, so the card asks for the
// system mono stack the DA falls back to anyway.
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

// Contribution ramp: one hue, five steps, bg -> accent.
const RAMP = ["#101014", "#152f4a", "#1b4a7d", "#2463b8", "#2e7cf6"];

// Language bar: accent first, then the neutral surfaces. No rainbow.
const LANG_FILL = ["#2e7cf6", "#5b6470", "#45454d", "#37373f", "#2c2d35", "#1d1d22"];

/* ── layout ───────────────────────────────────────────────────────────── */

const W = 900;
const PAD = 44;
const INNER = W - PAD * 2;
const CELL = 12;
const GAP = 3;
const STEP = CELL + GAP;

/* ── data ─────────────────────────────────────────────────────────────── */

const QUERY = `query($login:String!){
  user(login:$login){
    name login
    followers{ totalCount }
    repositories(first:100, ownerAffiliations:OWNER, isFork:false){
      totalCount
      nodes{
        stargazerCount
        languages(first:12, orderBy:{field:SIZE,direction:DESC}){ edges{ size node{ name } } }
      }
    }
    contributionsCollection{
      totalCommitContributions
      totalPullRequestContributions
      contributionCalendar{
        totalContributions
        weeks{ contributionDays{ date contributionCount weekday } }
      }
    }
  }
}`;

async function fetchUser(login) {
	const token = process.env.GITHUB_TOKEN;
	if (!token) throw new Error("GITHUB_TOKEN is not set");
	const res = await fetch("https://api.github.com/graphql", {
		method: "POST",
		headers: {
			authorization: `bearer ${token}`,
			"content-type": "application/json",
			"user-agent": `${login}-profile-card`,
		},
		body: JSON.stringify({ query: QUERY, variables: { login } }),
	});
	if (!res.ok) throw new Error(`GitHub API returned ${res.status}`);
	const body = await res.json();
	if (body.errors) throw new Error(body.errors.map((e) => e.message).join("; "));
	return body.data.user;
}

function shape(user) {
	const cc = user.contributionsCollection;
	const days = cc.contributionCalendar.weeks.flatMap((w) => w.contributionDays);

	// Longest run of consecutive days with at least one contribution.
	let best = 0;
	let run = 0;
	for (const d of days) {
		run = d.contributionCount > 0 ? run + 1 : 0;
		if (run > best) best = run;
	}

	const sizes = new Map();
	for (const repo of user.repositories.nodes)
		for (const { size, node } of repo.languages.edges)
			sizes.set(node.name, (sizes.get(node.name) ?? 0) + size);
	const total = [...sizes.values()].reduce((a, b) => a + b, 0) || 1;
	const ranked = [...sizes.entries()].sort((a, b) => b[1] - a[1]);

	const TOP = 5;
	const langs = ranked.slice(0, TOP).map(([name, size]) => ({
		name,
		share: (size / total) * 100,
	}));
	const rest = ranked.slice(TOP).reduce((a, [, size]) => a + size, 0);
	if (rest > 0) langs.push({ name: "other", share: (rest / total) * 100 });

	return {
		name: user.name ?? user.login,
		login: user.login,
		weeks: cc.contributionCalendar.weeks,
		days,
		langs,
		stats: {
			contributions: cc.contributionCalendar.totalContributions,
			commits: cc.totalCommitContributions,
			streak: best,
			followers: user.followers.totalCount,
			repos: user.repositories.totalCount,
			stars: user.repositories.nodes.reduce((a, r) => a + r.stargazerCount, 0),
		},
	};
}

/* ── drawing helpers ──────────────────────────────────────────────────── */

const esc = (s) =>
	String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function text(x, y, s, { size = 10, fill = C.muted, track = 0.14, weight = 400, anchor = "start" } = {}) {
	return `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" letter-spacing="${track}em" font-weight="${weight}" text-anchor="${anchor}">${esc(s)}</text>`;
}

const rule = (y) => `<rect x="${PAD}" y="${y}" width="${INNER}" height="1" fill="${C.line}"/>`;

function sectionLabel(y, n, label) {
	return (
		text(PAD, y, n, { size: 10, fill: C.accent, track: 0.16 }) +
		text(PAD + 26, y, `— ${label.toUpperCase()}`, { size: 10, fill: C.dim, track: 0.16 })
	);
}

/* ── the card ─────────────────────────────────────────────────────────── */

function render(d) {
	const level = (n) => (n === 0 ? 0 : n >= 10 ? 4 : n >= 6 ? 3 : n >= 3 ? 2 : 1);

	const gridW = d.weeks.length * STEP - GAP;
	const gridTop = 330;
	const gridH = 7 * STEP - GAP;

	/* heatmap, one group per week so the sweep can light columns in turn */
	let grid = "";
	d.weeks.forEach((week, w) => {
		const cells = week.contributionDays
			.map((day) => {
				const l = level(day.contributionCount);
				return `<rect x="0" y="${day.weekday * STEP}" width="${CELL}" height="${CELL}" fill="${RAMP[l]}"><title>${day.date}: ${day.contributionCount}</title></rect>`;
			})
			.join("");
		const delay = ((w / d.weeks.length) * 9).toFixed(2);
		grid += `<g transform="translate(${PAD + w * STEP},${gridTop})" class="wk" style="animation-delay:${delay}s">${cells}</g>`;
	});

	/* month ticks along the top of the grid */
	let months = "";
	let last = "";
	d.weeks.forEach((week, w) => {
		const first = week.contributionDays[0];
		if (!first) return;
		const m = new Date(first.date).toLocaleString("en", { month: "short", timeZone: "UTC" }).toUpperCase();
		if (m !== last && w < d.weeks.length - 2) {
			months += text(PAD + w * STEP, gridTop - 12, m, { size: 8, fill: C.lineStrong, track: 0.16 });
			last = m;
		}
	});

	/* four numbers */
	const cards = [
		[d.stats.contributions, "contributions"],
		[d.stats.commits, "commits"],
		[d.stats.streak, "longest streak"],
		[d.stats.followers, "followers"],
	];
	const colW = INNER / 4;
	const stats = cards
		.map(([value, label], i) => {
			const x = PAD + i * colW;
			return (
				(i > 0 ? `<rect x="${x - 20}" y="176" width="1" height="34" fill="${C.line}"/>` : "") +
				text(x, 206, value, { size: 34, fill: C.ink, track: -0.04, weight: 500 }) +
				text(x, 228, label.toUpperCase(), { size: 9, fill: C.muted, track: 0.14 })
			);
		})
		.join("");

	/* language bar + legend */
	const barY = 520;
	let cursor = PAD;
	const bar = d.langs
		.map((l, i) => {
			const w = Math.max(1, (l.share / 100) * INNER - (i < d.langs.length - 1 ? 2 : 0));
			const seg = `<rect x="${cursor.toFixed(1)}" y="${barY}" width="${w.toFixed(1)}" height="6" fill="${LANG_FILL[i] ?? C.line}"/>`;
			cursor += w + 2;
			return seg;
		})
		.join("");

	const legend = d.langs
		.map((l, i) => {
			const x = PAD + i * (INNER / d.langs.length);
			return (
				`<rect x="${x}" y="${barY + 26}" width="6" height="6" fill="${LANG_FILL[i] ?? C.line}"/>` +
				text(x + 14, barY + 32, l.name.toUpperCase(), { size: 9, fill: C.dim, track: 0.12 }) +
				text(x + 14, barY + 48, `${l.share.toFixed(1)}%`, { size: 12, fill: C.ink, track: -0.02 })
			);
		})
		.join("");

	const H = 660;

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(d.name)} — GitHub activity card">
<title>${esc(d.name)} — ${d.stats.contributions} contributions in the last year</title>
<style>
  text { font-family: ${MONO}; }
  .wk { animation: sweep 9s linear infinite; }
  .scan { animation: scan 9s linear infinite; }
  @keyframes sweep {
    0%, 100% { opacity: 1; }
    46%      { opacity: 1; }
    50%      { opacity: .45; }
    54%      { opacity: 1; }
  }
  @keyframes scan {
    from { transform: translateX(0); }
    to   { transform: translateX(${gridW}px); }
  }
  @media (prefers-reduced-motion: reduce) {
    .wk, .scan { animation: none; }
    .scan { opacity: 0; }
  }
</style>

<rect width="${W}" height="${H}" fill="${C.bg}"/>
<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" fill="none" stroke="${C.line}"/>
<rect x="0" y="0" width="${W}" height="2" fill="${C.accent}" opacity=".9"/>

<!-- header -->
${text(PAD, 62, d.name, { size: 21, fill: C.ink, track: -0.02, weight: 500 })}
${text(PAD, 84, "42 LE HAVRE — SYSTEMS, C, RUST, TYPESCRIPT", { size: 9, fill: C.muted, track: 0.16 })}
${text(W - PAD, 62, `@${d.login}`, { size: 12, fill: C.dim, track: 0.06, anchor: "end" })}
${text(W - PAD, 84, "VYNQ.DEV ↗", { size: 9, fill: C.accent, track: 0.16, anchor: "end" })}
${rule(120)}

<!-- 01 -->
${sectionLabel(152, "01", "activity")}
${stats}
${rule(262)}

<!-- 02 -->
${sectionLabel(292, "02", "last 12 months")}
${months}
${grid}
<g class="scan"><rect x="${PAD}" y="${gridTop - 6}" width="1" height="${gridH + 12}" fill="${C.accent}" opacity=".55"/></g>
${rule(gridTop + gridH + 34)}

<!-- 03 -->
${sectionLabel(498, "03", "languages")}
${bar}
${legend}

<!-- footer -->
${rule(H - 56)}
${text(PAD, H - 26, `${d.stats.repos} REPOSITORIES · ${d.stats.stars} STARS`, { size: 9, fill: C.muted, track: 0.14 })}
${text(W - PAD, H - 26, "GENERATED · NOT A THIRD-PARTY WIDGET", { size: 9, fill: C.lineStrong, track: 0.14, anchor: "end" })}
</svg>
`;
}

/* ── main ─────────────────────────────────────────────────────────────── */

const fixtureAt = process.argv.indexOf("--fixture");
const user =
	fixtureAt !== -1
		? JSON.parse(readFileSync(process.argv[fixtureAt + 1], "utf8")).data.user
		: await fetchUser(USER);

const data = shape(user);
if (data.stats.contributions === 0)
	console.error("warning: the calendar came back empty — the token may lack access to contribution data");

const outAt = process.argv.indexOf("--out");
writeFileSync(outAt !== -1 ? process.argv[outAt + 1] : "card.svg", render(data));
