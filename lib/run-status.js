import v8 from 'node:v8';

import Emittery from 'emittery';

const copyStats = stats => v8.deserialize(v8.serialize(stats));

export default class RunStatus extends Emittery {
	constructor(files, parallelRuns, selectionInsights) {
		super();

		this.pendingTests = new Map();

		this.emptyParallelRun = parallelRuns
			&& parallelRuns.currentFileCount === 0
			&& parallelRuns.totalRuns > 1
			&& files > 0;

		this.selectionInsights = selectionInsights;

		this.stats = {
			byFile: new Map(),
			declaredTests: 0,
			failedHooks: 0,
			failedTests: 0,
			failedWorkers: 0,
			files,
			parallelRuns,
			finishedWorkers: 0,
			internalErrors: 0,
			remainingTests: 0,
			passedKnownFailingTests: 0,
			passedTests: 0,
			selectedTests: 0,
			sharedWorkerErrors: 0,
			skippedTests: 0,
			timeouts: 0,
			todoTests: 0,
			uncaughtExceptions: 0,
			unhandledRejections: 0,
		};
	}

	observeWorker(worker, testFile, stats) {
		this.stats.byFile.set(testFile, {
			declaredTests: 0,
			failedHooks: 0,
			failedTests: 0,
			internalErrors: 0,
			remainingTests: 0,
			passedKnownFailingTests: 0,
			passedTests: 0,
			selectedTests: 0,
			selectingLines: false,
			skippedTests: 0,
			todoTests: 0,
			uncaughtExceptions: 0,
			unhandledRejections: 0,
			...stats,
		});

		this.pendingTests.set(testFile, new Set());
		worker.onStateChange(data => this.emitStateChange(data));
	}

	emitStateChange(event) {
		const {stats} = this;
		const fileStats = stats.byFile.get(event.testFile);

		let changedStats = true;
		switch (event.type) {
			case 'declared-test':
				stats.declaredTests++;
				fileStats.declaredTests++;
				break;
			case 'hook-failed':
				stats.failedHooks++;
				fileStats.failedHooks++;
				break;
			case 'internal-error':
				stats.internalErrors++;
				if (event.testFile) {
					fileStats.internalErrors++;
				}

				break;
			case 'selected-test':
				stats.selectedTests++;
				fileStats.selectedTests++;
				if (event.skip) {
					stats.skippedTests++;
					fileStats.skippedTests++;
				} else if (event.todo) {
					stats.todoTests++;
					fileStats.todoTests++;
				} else {
					stats.remainingTests++;
					fileStats.remainingTests++;
					this.addPendingTest(event);
				}

				break;
			case 'shared-worker-error':
				stats.sharedWorkerErrors++;
				break;
			case 'test-failed':
				stats.failedTests++;
				fileStats.failedTests++;
				stats.remainingTests--;
				fileStats.remainingTests--;
				this.removePendingTest(event);
				break;
			case 'test-passed':
				if (event.knownFailing) {
					stats.passedKnownFailingTests++;
					fileStats.passedKnownFailingTests++;
				} else {
					stats.passedTests++;
					fileStats.passedTests++;
				}

				stats.remainingTests--;
				fileStats.remainingTests--;
				this.removePendingTest(event);
				break;
			case 'timeout':
				event.pendingTests = this.pendingTests;
				this.pendingTests = new Map();
				stats.timeouts++;
				break;
			case 'interrupt':
				event.pendingTests = this.pendingTests;
				this.pendingTests = new Map();
				break;
			case 'uncaught-exception':
				stats.uncaughtExceptions++;
				fileStats.uncaughtExceptions++;
				break;
			case 'unhandled-rejection':
				stats.unhandledRejections++;
				fileStats.unhandledRejections++;
				break;
			case 'worker-failed':
				stats.failedWorkers++;
				break;
			case 'worker-finished':
				stats.finishedWorkers++;
				break;
			default:
				changedStats = false;
				break;
		}

		if (changedStats) {
			this.emit('stateChange', {type: 'stats', stats: copyStats(stats)});
		}

		this.emit('stateChange', event);
	}

	suggestExitCode(circumstances) {
		if (this.emptyParallelRun) {
			return 0;
		}

		if (circumstances.matching && this.stats.selectedTests === 0) {
			return 1;
		}

		if (
			this.stats.declaredTests === 0
			|| this.stats.internalErrors > 0
			|| this.stats.failedHooks > 0
			|| this.stats.failedTests > 0
			|| this.stats.failedWorkers > 0
			|| this.stats.sharedWorkerErrors > 0
			|| this.stats.timeouts > 0
			|| this.stats.uncaughtExceptions > 0
			|| this.stats.unhandledRejections > 0
		) {
			return 1;
		}

		if ([...this.stats.byFile.values()].some(stats => stats.selectingLines && stats.selectedTests === 0)) {
			return 1;
		}

		return 0;
	}

	addPendingTest(event) {
		if (this.pendingTests.has(event.testFile)) {
			this.pendingTests.get(event.testFile).add(event.title);
		}
	}

	removePendingTest(event) {
		if (this.pendingTests.has(event.testFile)) {
			this.pendingTests.get(event.testFile).delete(event.title);
		}
	}

	getFailedTestFiles() {
		return [...this.stats.byFile].filter(statByFile => statByFile[1].failedTests).map(statByFile => statByFile[0]);
	}
}
