'use strict';

var workerTemplate = require('./workerTemplate');

var CORES = navigator.hardwareConcurrency || 1;

function noop() {
}

function WorkerManager(func, options) {

    // Check arguments
    if (typeof func !== 'function')
        throw new TypeError('func argument must be a function');
    if (options === undefined)
        options = {};
    if (typeof options !== 'object' || options === null)
        throw new TypeError('options argument must be an object');

    this._workerCode = func.toString();

    // Parse options
    this._numWorkers = (options.maxWorkers > 0) ? Math.min(options.maxWorkers, CORES) : CORES;
    this._workers = new Array(this._numWorkers);
    this._timeout = options.timeout || 0;
    this._terminateOnError = !!options.terminateOnError;

    var deps = options.deps;
    if (typeof deps === 'string')
        deps = [deps];

    this._terminated = false;
    this._working = 0;
    this._waiting = [];

    this._init(deps);

}

WorkerManager.prototype._init = function (deps) {

    var workerURL = workerTemplate.newWorkerURL(this._workerCode);

    for (var i = 0; i < this._numWorkers; i++) {
        var worker = new Worker(workerURL);
        worker.postMessage({
            action: 'init',
            id: i,
            deps: deps
        });
        worker.onmessage = this._onmessage.bind(this, worker);
        worker.onerror = this._onerror.bind(this, worker);
        worker.running = false;
        this._workers[i] = worker;
    }

    URL.revokeObjectURL(workerURL);

};

WorkerManager.prototype._onerror = function (worker, error) {
    if (this._terminated)
        return;
    this._working--;
    worker.currentCallback(error);
    worker.running = false;
    if (this._terminateOnError) {
        this.terminate();
    } else {
        this._exec();
    }
};

WorkerManager.prototype._onmessage = function (worker, event) {
    if (this._terminated)
        return;
    this._working--;
    worker.currentCallback(null, event.data);
    worker.running = false;
    this._exec();
};

WorkerManager.prototype._exec = function () {
    if (this._working === this._numWorkers || this._waiting.length === 0)
        return;
    for (var i = 0; i < this._numWorkers; i++) {
        if (!this._workers[i].running) {
            var execInfo = this._waiting.shift();
            var worker = this._workers[i];
            worker.postMessage({
                action: 'exec',
                event: execInfo[0],
                args: execInfo[1]
            });
            worker.running = true;
            worker.time = Date.now();
            worker.currentCallback = execInfo[2] || noop;
            this._working++;
            break;
        }
    }
};

WorkerManager.prototype.terminate = function () {
    if (this._terminated)
        return;
    for (var i = 0; i < this._numWorkers; i++) {
        this._workers[i].terminate();
    }
    this._terminated = true;
};

WorkerManager.prototype.postAll = function (event, args) {
    if (this._terminated)
        throw new Error('Cannot post (terminated)');
    for (var i = 0; i < this._numWorkers; i++) {
        this._workers[i].postMessage({
            action: 'exec',
            event: event,
            args: args
        });
    }
};

WorkerManager.prototype.post = function (event, args, callback) {
    if (this._terminated)
        throw new Error('Cannot post (terminated)');
    this._waiting.push([event, args, callback]);
    this._exec();
};

module.exports = WorkerManager;