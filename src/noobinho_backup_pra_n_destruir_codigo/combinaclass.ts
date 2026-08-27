async combineClasses(classes: Class[][]): Promise<Class[][]> {
    const optimalNumberWorkers = window.navigator.hardwareConcurrency;
    const browserSupportsWebWorkers = this.getBrowserSupportForWorkers();

    const totalClasses = classes && classes.length !== 0 ? classes.map(val => val.length).reduce((total, val) => total + val) : 0;
    const incBar = 80;

    // Create workers
    const workers: Worker[] = [];
    if (browserSupportsWebWorkers) {
      for (let i = 0; i < optimalNumberWorkers; i++) {
        const worker = new Worker(new URL('../../_workers/generation-worker.worker', import.meta.url), {type: 'module'});
        workers.push(worker);
      }
    }

    // Sort classes by least
    classes.sort(((a, b) => a.length - b.length));

    // Get combinations of classes
    let combinations: Class[][] = [];
    for (const cls of classes) {

      if (!browserSupportsWebWorkers) {
        const allCases = this.allPossibleCases([combinations, cls]);
        combinations = [];
        for (const combination of allCases) {
          // Check for overlaps and discard
          if (this.checkForOverlapsOnClasses(combination)) continue;
          combinations.push(combination);
        }
      } else {
        const numberClasses = cls.length;
        const fracOfClasses = numberClasses / totalClasses;
        const classesPerWorker = Math.floor(numberClasses / optimalNumberWorkers);

        let mod = numberClasses % optimalNumberWorkers;
        let tempCombinations = [];

        let workersUsed = 0;
        let workersLeft = 0;

        const allWorkersFinished = new EventEmitter<void>();
        const allFinished = new Promise<void>((resolve) => allWorkersFinished.subscribe(() => resolve()));

        let i = 0;
        let workerIndex = 0;
        while (i < numberClasses) {
          workers[workerIndex].onmessage = async ({data}) => {
            tempCombinations = tempCombinations.concat(this.parseData(data));
            workersLeft--;
            this.updateBar((incBar * fracOfClasses) / workersUsed);
            if (workersLeft === 0) allWorkersFinished.emit();
          };

          if (mod > 0) {
            workers[workerIndex].postMessage({worker: workerIndex + 1, combinations, classes: cls.slice(i, i + classesPerWorker + 1)});
            mod--;
            i = i + classesPerWorker + 1;

          } else {
            workers[workerIndex].postMessage({worker: workerIndex + 1, combinations, classes: cls.slice(i, i + classesPerWorker)});
            i = i + classesPerWorker;
          }
          workersUsed++;
          workersLeft++;
          workerIndex++;
        }

        await allFinished;
        combinations = [...tempCombinations];
        this.logger.log('all combinations with course ' + cls[0].course.formatAcronym() + ' finished', combinations);
      }
      if (combinations.length === 0) return [];
    }

    // Terminate workers
    for (const worker of workers)
      worker.terminate();
    return combinations;
  }