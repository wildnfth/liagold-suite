# Firebase RTDB rules (scanner)

The userscript talks to `stock-baki-default-rtdb` **without Firebase Auth**.
These rules shrink the blast radius. They do **not** replace a real login.

Paste into Firebase Console → Realtime Database → Rules. Adjust only if you
know you need public list.

```json
{
  "rules": {
    "opname": {
      "$session": {
        ".read": "true",
        ".write": "true",
        ".validate": "$session.matches(/^[A-Z0-9]{6,16}$/)",
        "meta": {
          ".validate": "newData.hasChildren(['dibuat'])"
        },
        "history": {
          "$key": {
            ".validate": "newData.hasChildren(['codeProduct', 'status', 'time'])"
          }
        }
      }
    }
  }
}
```

Do **not** set `".read": true` / `".write": true` on the database root — that
lets anyone list every session.

The script no longer auto-`DELETE`s `/opname/$session` when the 12h TTL
fires. Use **Selesai & Hapus** in the panel when the team is done.
