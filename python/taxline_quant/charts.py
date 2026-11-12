"""Static SVG charts for the report, in a light and a dark variant.

Matplotlib's Agg-free SVG backend with a fixed hash salt and no date metadata,
so the same inputs give the same file. Text stays text (no glyph outlines), in
ink colors only; series identity is carried by the marks, a legend, and direct
labels. The palettes were checked for color-vision separation against each
surface. Money is converted to float here and only here, for plotting.
"""

from __future__ import annotations

import io
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final

import matplotlib

matplotlib.use("svg")

import matplotlib.pyplot as plt
from matplotlib.axes import Axes
from matplotlib.figure import Figure
from matplotlib.ticker import FuncFormatter

from .evals.metrics import REVIEW_THRESHOLD, Evaluation
from .montecarlo import Projection
from .scenarios import SweepPoint


@dataclass(frozen=True, slots=True)
class Theme:
    name: str
    surface: str
    ink: str
    ink_muted: str
    grid: str
    series: tuple[str, str, str]


LIGHT: Final = Theme(
    "light", "#ffffff", "#1c1b18", "#5c574e", "#e4e0d8", ("#1baf7a", "#eb6834", "#2a78d6")
)
DARK: Final = Theme(
    "dark", "#16181a", "#ece8e0", "#a6a29a", "#2c3033", ("#3da57b", "#d95926", "#3987e5")
)
THEMES: Final = (LIGHT, DARK)

_FONT_STACK: Final = "'IBM Plex Sans', 'Helvetica Neue', Arial, sans-serif"
_SIZE: Final = (8.0, 4.4)


def _figure(theme: Theme) -> tuple[Figure, Axes]:
    plt.rcParams.update(
        {
            "svg.hashsalt": "taxline-quant",
            "svg.fonttype": "none",
            "font.family": "DejaVu Sans",
            "font.size": 10.5,
            "axes.titlesize": 12.5,
            "axes.titleweight": "bold",
            "axes.titlelocation": "left",
            "axes.titlepad": 14,
        }
    )
    fig, ax = plt.subplots(figsize=_SIZE)
    fig.patch.set_facecolor(theme.surface)
    ax.set_facecolor(theme.surface)
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        ax.spines[side].set_color(theme.grid)
    ax.tick_params(colors=theme.ink_muted, length=0, pad=6)
    ax.grid(axis="y", color=theme.grid, linewidth=1)
    ax.set_axisbelow(True)
    ax.xaxis.label.set_color(theme.ink_muted)
    ax.yaxis.label.set_color(theme.ink_muted)
    return fig, ax


def _svg(fig: Figure) -> str:
    buffer = io.StringIO()
    fig.tight_layout()
    fig.savefig(buffer, format="svg", metadata={"Date": None, "Creator": "taxline_quant"})
    plt.close(fig)
    text = buffer.getvalue().replace("'DejaVu Sans'", _FONT_STACK)
    return "\n".join(line.rstrip() for line in text.splitlines()) + "\n"


def _legend(ax: Axes, theme: Theme, *, lower: bool = False) -> None:
    legend = ax.legend(loc="lower left" if lower else "upper left", frameon=False, handlelength=1.6)
    for text in legend.get_texts():
        text.set_color(theme.ink)


def _dollars(value: float, _pos: int) -> str:
    return f"${value / 1000:,.0f}K" if abs(value) >= 1000 else f"${value:,.0f}"


def _percent(value: float, _pos: int) -> str:
    return f"{value * 100:.0f}%"


def rates_chart(points: Sequence[SweepPoint], theme: Theme) -> str:
    """Effective and marginal rate against self-employment profit."""
    fig, ax = _figure(theme)
    x = [float(p.x) for p in points]
    marginal = [float(p.marginal_rate) for p in points]
    effective = [float(p.effective_rate) for p in points]
    ax.step(x, marginal, where="post", color=theme.series[1], linewidth=2, label="Marginal rate")
    ax.plot(x, effective, color=theme.series[0], linewidth=2, label="Effective rate")
    ax.annotate(
        f"{effective[-1] * 100:.1f}%",
        (x[-1], effective[-1]),
        xytext=(6, 0),
        textcoords="offset points",
        color=theme.ink,
        va="center",
    )
    ax.annotate(
        f"{marginal[-1] * 100:.1f}%",
        (x[-1], marginal[-1]),
        xytext=(6, 0),
        textcoords="offset points",
        color=theme.ink,
        va="center",
    )
    ax.set_title("Tax rate on self-employment profit, single filer, TY2026", color=theme.ink)
    ax.set_xlabel("Net self-employment profit")
    ax.xaxis.set_major_formatter(FuncFormatter(_dollars))
    ax.yaxis.set_major_formatter(FuncFormatter(_percent))
    ax.set_ylim(0, max(marginal) * 1.12)
    ax.set_xlim(0, x[-1] * 1.07)
    _legend(ax, theme)
    return _svg(fig)


def montecarlo_chart(projection: Projection, theme: Theme) -> str:
    """Histogram of simulated total tax with the 5th, 50th, and 95th percentiles."""
    fig, ax = _figure(theme)
    values = [float(v) for v in projection.samples_total_tax]
    ax.hist(
        values,
        bins=60,
        color=theme.series[0],
        edgecolor=theme.surface,
        linewidth=0.6,
    )
    top = ax.get_ylim()[1]
    for p, align in ((5, "right"), (50, "left"), (95, "left")):
        v = float(projection.total_tax.percentile(p))
        ax.axvline(v, color=theme.ink_muted, linewidth=1)
        ax.annotate(
            f"p{p}  ${v:,.0f}",
            (v, top),
            xytext=(-5 if align == "right" else 5, -2),
            textcoords="offset points",
            color=theme.ink,
            ha=align,
            va="top",
        )
    ax.set_title(
        f"Simulated total tax, {projection.draws:,} draws, "
        f"profit forecast ${projection.forecast_profit:,.0f}, CV {projection.cv}",
        color=theme.ink,
    )
    ax.set_xlabel("Total federal tax for the year")
    ax.set_ylabel("Draws")
    ax.xaxis.set_major_formatter(FuncFormatter(_dollars))
    ax.set_xlim(0, float(projection.total_tax.percentile(95)) * 1.6)
    return _svg(fig)


def reliability_chart(evaluations: Sequence[tuple[str, Evaluation]], theme: Theme) -> str:
    """Accuracy against stated confidence, one line per extractor profile."""
    fig, ax = _figure(theme)
    ax.plot([0.5, 1], [0.5, 1], color=theme.ink_muted, linewidth=1, label="Perfect calibration")
    for i, (name, evaluation) in enumerate(evaluations):
        bins = [b for b in evaluation.calibration.bins if b.count]
        ax.plot(
            [b.mean_confidence for b in bins],
            [b.accuracy for b in bins],
            color=theme.series[i],
            linewidth=2,
            marker="o",
            markersize=8,
            markeredgecolor=theme.surface,
            markeredgewidth=2,
            label=f"{name} (ECE {evaluation.calibration.expected_calibration_error:.3f})",
        )
    ax.set_title("Reliability of extraction confidence, simulated extractor", color=theme.ink)
    ax.set_xlabel("Mean stated confidence in bin")
    ax.set_ylabel("Share of fields correct")
    ax.xaxis.set_major_formatter(FuncFormatter(_percent))
    ax.yaxis.set_major_formatter(FuncFormatter(_percent))
    ax.set_xlim(0.5, 1.02)
    ax.set_ylim(0.5, 1.02)
    _legend(ax, theme)
    return _svg(fig)


def gate_chart(evaluations: Sequence[tuple[str, Evaluation]], theme: Theme) -> str:
    """Share of auto-accepted fields that are wrong, by review threshold."""
    fig, ax = _figure(theme)
    for i, (name, evaluation) in enumerate(evaluations):
        ax.plot(
            [row.threshold for row in evaluation.gate],
            [row.escape_rate for row in evaluation.gate],
            color=theme.series[i],
            linewidth=2,
            marker="o",
            markersize=8,
            markeredgecolor=theme.surface,
            markeredgewidth=2,
            label=name,
        )
    top = max(row.escape_rate for _, ev in evaluations for row in ev.gate) * 1.22
    ax.set_ylim(0, top)
    ax.axvline(REVIEW_THRESHOLD, color=theme.ink_muted, linewidth=1)
    ax.annotate(
        f"service gate {REVIEW_THRESHOLD}",
        (REVIEW_THRESHOLD, top),
        xytext=(-5, -2),
        textcoords="offset points",
        color=theme.ink,
        ha="right",
        va="top",
    )
    ax.set_title("Wrong fields that clear the review gate, by threshold", color=theme.ink)
    ax.set_xlabel("Confidence threshold")
    ax.set_ylabel("Error rate among auto-accepted fields")
    ax.yaxis.set_major_formatter(FuncFormatter(lambda v, _pos: f"{v * 100:.1f}%"))
    _legend(ax, theme, lower=True)
    return _svg(fig)
