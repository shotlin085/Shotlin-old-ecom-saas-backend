import connectDB from "./db/Database.js";
import app from "./app.js";
import os from "os";
import cluster from "cluster";
import { PORT } from "./constants.js";



// Get the total number of CPUs
const totalCPUs = os.cpus().length;

if (cluster.isMaster) {
    console.log(`Master process running. Total CPUs: ${totalCPUs}`);

    // Fork workers for each CPU
    for (let i = 0; i < totalCPUs; i++) {
        cluster.fork();
    }

    // Restart a worker if it dies
    cluster.on("exit", (worker, code, signal) => {
        console.error(`Worker ${worker.process.pid} exited. Restarting...`);
        cluster.fork();
    });
} else {
    // Worker process: connect to the database and start the server
    connectDB()
        .then(() => {
            const port = PORT || 8000;
            app.listen(port, () => {
                console.log(`Worker ${process.pid} running on http://localhost:${port}`);
            });
        })
        .catch((error) => {
            console.error("Database connection failed:", error);
            process.exit(1); // Exit process if the database connection fails
        });
}



// // Worker process: connect to the database and start the server
// connectDB()
//     .then(() => {
//         const port = PORT || 8000;
//         app.listen(port, () => {
//             console.log(`Server running on http://localhost:${port}`);
//         });
//     })
//     .catch((error) => {
//         console.error("Database connection failed:", error);
//         process.exit(1); // Exit process if the database connection fails
//     });