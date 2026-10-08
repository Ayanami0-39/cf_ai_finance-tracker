import json
import sqlite3
import sys

db = sqlite3.connect(':memory:')
db.row_factory = sqlite3.Row
for line in sys.stdin:
    try:
        request = json.loads(line)
        if 'schema' in request:
            db.executescript(request['schema'])
            result = []
        else:
            result = []
            with db:
                for statement in request['statements']:
                    before = db.total_changes
                    cursor = db.execute(statement['sql'], statement.get('values', []))
                    rows = [dict(row) for row in cursor.fetchall()] if cursor.description else []
                    result.append({'success': True, 'results': rows, 'meta': {'changes': db.total_changes - before}})
        print(json.dumps({'result': result}), flush=True)
    except Exception as error:
        print(json.dumps({'error': str(error)}), flush=True)
