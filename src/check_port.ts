// from https://stackoverflow.com/a/29872303
import net from "net";

export async function portInUse(port: number): Promise<boolean> {
  var server = net.createServer((socket) => {
    socket.write("Echo server\r\n");
    socket.pipe(socket);
  });

  const inUse = new Promise<boolean>((resolve) => {
    server.on("error", (e) => {
      if ((e as any).code === "EADDRINUSE") {
        resolve(true);
      } else {
        resolve(false);
      }
    });
    server.on("listening", (e) => {
      resolve(false);
      server.close();
    });
    setTimeout(() => {
      resolve(true); // assume in use if not listening after 1s
    }, 1000);
  });

  server.listen(port, "127.0.0.1");
  return await inUse;
}
