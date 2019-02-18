import {cpus} from 'os';
import {Stats, lstat, readdir, writeFileSync} from 'fs';
import {join} from 'path';
import {fork, Worker, isMaster, on as clusterOn} from 'cluster';

export interface INode {
    isDir: boolean;
    size: number;
    path: string;
    children?: INode[];
    parent?: INode;
}

export interface Job {
    path: string;
    parent?: INode;
}

function formatNode(path: string, cb: any): void {
    lstat(path, (err, nodeStats: Stats) => {
        if (err) {
            return cb(err);
        }
        const node: INode = {
            isDir: nodeStats.isDirectory(),
            size: nodeStats.size / 1024, // size in KB
            path,
        };
        if (node.isDir) {
            node.children = [];
            readdir(path, (err2: any, files: string[]) => {
                return cb(err2, node, files);
            });
        } else {
            return cb(null, node);
        }
    });
}

if (isMaster) {
    const workers: Worker[] = [];
    const inactive: Worker[] = [];
    const tree: INode[] = [];
    const jobs: Job[] = [];

    const assignments: {[key: number]: Job} = {};

    if (process.argv.length < 3) {
        console.log('USAGE: node scan.js <Root path to scan>');
        process.exit(0);
    }

    const root = process.argv[2];

    formatNode(root, (error: any, rootNode: INode, rootChildren: string[]) => {
        if (error) {
            console.error(error);
            process.exit(1);
        }
        tree.push(rootNode);
        jobs.push(...rootChildren.map(cpath => ({parent: rootNode, path: join(rootNode.path, cpath)})));

        function handleJobs() {
            while(jobs.length && inactive.length) {
                const newWorker = inactive.shift();
                const job = jobs.shift();
                // console.log(`Assigning worker ${newWorker.id} to scan ${job.path}`);
                assignments[newWorker.id] = job;
                newWorker.send({type: 'format', args: [job.path]});
            }
            if (jobs.length < 1 && inactive.length === workers.length) {
                writeFileSync('./tree.json', JSON.stringify(tree, null, 2));
                console.log('done scanning!');
                process.exit(0);
            }
        }

        function forkWorker(): Worker {
            const worker = fork();

            worker.on('exit', (code, signal) => {
                console.log(`[ worker ${worker.id} ]: exiting with code {${code}}${ signal ? ` in response to signal {${signal}}`: ''}`);
            });
        
            worker.on('error', (err) => {
                console.error(`[ worker ${worker.id} ]: ERROR`, err);
            });
            return worker;
        }

        clusterOn('online', (worker) => {
            console.log(`worker ${worker.id} started`);
            if (jobs.length) {
                const doomed = inactive.findIndex(i => i.id === worker.id);
                if (doomed >= 0) {
                    inactive.splice(doomed, 1);
                }
                const job = jobs.shift();
                // console.log(`Assigning worker ${worker.id} to scan ${job.path}`);
                assignments[worker.id] = job;
                worker.send({type: 'format', args: [job.path]});
            } else {
                console.log('no jobs in queue');
            }
        });

        clusterOn('exit', (worker, code, signal) => {
            const deadIndex = workers.findIndex(w => w.id === worker.id);
            if (deadIndex >= 0) {
                workers.splice(deadIndex, 1);
            }
            if (!worker.exitedAfterDisconnect) {
                console.log(`[ master ]: replacing crashed worker ${worker.id}`);
                const newWorker = forkWorker();
                workers.push(newWorker);
                inactive.push(newWorker);
            }
        });

        clusterOn('message', (worker, messages, handle) => {
            if (Array.isArray(messages)) { // one of ours
                if (messages[0] === 'error') {
                    console.error(messages[1]);
                    inactive.push(worker);
                    handleJobs();
                } else if (messages[0] === 'done') {
                    inactive.push(worker);
                    const result = messages[1];
                    const assignment = assignments[worker.id];
                    if (assignment.parent) {
                        const parent = assignment.parent;
                        parent.children.push(result.node);
                        if (!result.node.isDir) {
                            parent.size += result.node.size;
                        }
                    } else {
                        tree.push(result.node); // just in case we somehow get an orphaned node
                    }
                    if (result.children) {
                        jobs.push(...result.children.map(cpath => ({parent: result.node, path: join(result.node.path, cpath)})));
                    }
                    handleJobs();
                }
            }
        });

        process.on('exit', () => {
            console.log('[ master ]: killing workers');
            workers.forEach((worker) => worker.kill());
        });

        const numCpus = Math.max(cpus().length, 2); // make sure we have at least one worker
        console.log(`spinning up ${numCpus - 1} workers`);
        for (let i=0; i < numCpus - 1; i++) {
            const worker = forkWorker();
            workers.push(worker);
            inactive.push(worker);
        }
    });
} else {
    process.on('message', (data: {type: string, args: any[]}) => {
        if (data.type === 'format') {
            formatNode(data.args[0], (error, node, children) => {
                if (error) {
                    process.send(['error', error]);
                } else {
                    process.send(['done', {node, children}]);
                }
            });
        }
    });
}