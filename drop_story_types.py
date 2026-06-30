from sqlalchemy import text
from app.db.session import get_session
import asyncio

async def drop():
    async for db in get_session():
        for t in ['story_comments','epics','sprints','stories']:
            await db.execute(text(f'DROP TABLE IF EXISTS "{t}" CASCADE'))
        for t in ['story_status','story_priority','story_estimate','story_source','story_jira_sync_status','sprint_status','epic_status']:
            await db.execute(text(f'DROP TYPE IF EXISTS "{t}"'))
        await db.commit()
        print('dropped')

asyncio.run(drop())