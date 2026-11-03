import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RexService } from "../electron/rex/service.js";
import { localEndpoint } from "../electron/rex/control.js";

test(
  "installed Rex resolves file, temporary and shared-memory images into direct client payloads",
  {
    skip: process.env.REX_INTEGRATION !== "1" || process.platform !== "linux",
    timeout: 15000,
  },
  async () => {
    const directory = await mkdtemp(
        join(tmpdir(), "linusaurus-kitty-lifetime-"),
      ),
      shared = `linusaurus-image-probe-${randomUUID()}`;
    const cases = [
      {
        medium: "f",
        path: join(directory, "persistent.rgb"),
        file: join(directory, "persistent.rgb"),
      },
      {
        medium: "t",
        path: join(directory, "tty-graphics-protocol-temporary.rgb"),
        file: join(directory, "tty-graphics-protocol-temporary.rgb"),
      },
      { medium: "s", path: "/" + shared, file: "/dev/shm/" + shared },
    ];
    for (const item of cases)
      await writeFile(item.file, Buffer.from([255, 0, 0]), { mode: 0o600 });
    const rex = new RexService(),
      host = {
        id: "local-image-probe",
        label: "Owned image test",
        endpoint: localEndpoint(),
      };
    let session: string | undefined, stop: (() => void) | undefined;
    const frames: string[] = [],
      observed: { medium: string; existsWhenDelivered: boolean }[] = [];
    const code = `import os,tty,termios,time,select,base64,json\nfd=os.open('/dev/tty',os.O_RDWR);old=termios.tcgetattr(fd);tty.setraw(fd)\nos.write(fd,b'FILE_READY\\r\\n');os.read(fd,1)\nfor idx,item in enumerate(json.loads(${JSON.stringify(JSON.stringify(cases))})):\n command='\\x1b_Ga=T,f=24,s=1,v=1,i='+str(700+idx)+',C=1,t='+item['medium']+';'+base64.b64encode(item['path'].encode()).decode()+'\\x1b\\\\'\n os.write(fd,command.encode());time.sleep(.1)\n ack=os.read(fd,4096) if select.select([fd],[],[],1)[0] else b'none'\n os.write(fd,('ACK:'+item['medium']+':'+base64.b64encode(ack).decode()+'\\r\\n').encode())\nos.write(fd,b'FILES_DONE\\r\\n');time.sleep(.5);termios.tcsetattr(fd,termios.TCSANOW,old)\ntime.sleep(.1)`;
    const quote = (text: string) => "'" + text.replaceAll("'", "'\"'\"'") + "'";
    const commands = () =>
      [...frames.join("").matchAll(/\x1b_G([^\x1b]*)\x1b\\/g)].filter((match) =>
        /(?:^|,)i=70[012](?:,|;)/.test(match[1]),
      );
    const waitFor = async (predicate: () => boolean) => {
      for (let attempt = 0; attempt < 150; attempt++) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      throw new Error("Owned file-image probe timed out.");
    };
    try {
      session = await rex.createSession(
        host,
        `kitty-file-lifetime-${randomUUID()}`,
        process.cwd(),
        "/usr/bin/python3 -u -c " + quote(code),
      );
      const view = await rex.inspect(host, session),
        block = view.windows[0].panes[0].id;
      stop = rex.subscribe(
        host,
        session,
        block,
        (data) => {
          frames.push(data);
          for (const match of commands()) {
            const index = Number(/(?:^|,)i=(\d+)/.exec(match[1])?.[1]) - 700;
            if (
              index >= 0 &&
              index < cases.length &&
              !observed.some((item) => item.medium === cases[index].medium)
            )
              observed.push({
                medium: cases[index].medium,
                existsWhenDelivered: existsSync(cases[index].file),
              });
          }
        },
        () => {},
      );
      await waitFor(() => frames.join("").includes("FILE_READY"));
      await rex.input(host, session, block, "X");
      await waitFor(() => frames.join("").includes("FILES_DONE"));
      const all = frames.join(""),
        acks = Object.fromEntries(
          [...all.matchAll(/ACK:([fts]):([A-Za-z0-9+/=]+)/g)].map((match) => [
            match[1],
            Buffer.from(match[2], "base64").toString(),
          ]),
        );
      for (const medium of ["f", "t", "s"])
        assert.match(acks[medium] || "", /;OK/);
      assert.equal(existsSync(cases[0].file), true);
      assert.equal(existsSync(cases[1].file), false);
      assert.equal(existsSync(cases[2].file), false);
      const normalized = commands();
      assert.equal(
        normalized.length,
        3,
        "All three server-side transports must reach the client",
      );
      for (const match of normalized) {
        assert.match(match[1], /(?:^|,)t=d,/);
        assert.ok(
          match[1].endsWith(";/wAA"),
          "Client must receive RGB pixels, not a server pathname",
        );
      }
      for (const item of cases)
        assert.ok(
          !normalized.some((match) =>
            match[1].includes(Buffer.from(item.path).toString("base64")),
          ),
        );
      console.log("Rex-normalized image transports:", JSON.stringify(observed));
    } finally {
      stop?.();
      if (session)
        await rex
          .callMethod(host, "session.destroy", { session_id: session })
          .catch(() => {});
      rex.dispose();
      for (const item of cases) await rm(item.file, { force: true });
      await rm(directory, { recursive: true, force: true });
    }
  },
);
