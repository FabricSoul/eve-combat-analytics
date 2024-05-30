import 'chartjs-adapter-luxon';

export interface LineChartDataset {
	label: string;
	data: { x: Date; y: number; combatMessage: string }[];
	backgroundColor?: string;
	borderColor?: string;
	tension?: number;
}

export interface PieChartDataset {
	labels: string[];
	datasets: PieChartData;
}

export interface PieChartData {
	data: number[];
	backgroundColor?: string[];
	hoverOffset?: number;
}

export const lineChartOptions = {
	responsive: true,
	maintainAspectRatio: false,
	plugins: {
		legend: {
			labels: {
				usePointStyle: true
			},
			position: 'bottom'
		},
		tooltip: {
			callbacks: {
				label: function (context) {
					const dataPoint = context.raw;
					return `${dataPoint.combatMessage || ''}`;
				}
			}
		},
		zoom: {
			wheel: {
				enabled: true
			},
			pinch: {
				enabled: true
			},
			mode: 'x'
		}
	},
	scales: {
		x: {
			type: 'time',
			time: {
				parser: "yyyy-MM-dd'T'HH:mm:ss.SSSXXX",
				unit: 'minute',
				tooltipFormat: 'HH:mm:ss',
				displayFormats: {
					minute: 'HH:mm',
					hour: 'HH:mm'
				}
			},
			adapters: {
				date: {
					zone: 'UTC+0'
				}
			},
			grid: {
				display: false
			},
			ticks: {
				autoSkip: true,
				maxTicksLimit: 10
			}
		},
		y: {
			grid: {
				color: 'rgba(0, 0, 0, 0.1)',
				drawTicks: false
			},
			ticks: {
				autoSkip: true,
				maxTicksLimit: 10
			}
		}
	},
	elements: {
		line: {
			borderWidth: 1,
			tension: 0,
			fill: false
		},
		point: {
			radius: 0
		}
	},
	interaction: {
		intersect: false,
		mode: 'index'
	},
	hover: {
		mode: 'nearest',
		intersect: true
	}
};
