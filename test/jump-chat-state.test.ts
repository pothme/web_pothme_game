import {test} from 'node:test';
import assert from 'node:assert/strict';
import {jumpChatDraft,mergeJumpChats,JUMP_CHAT_LIMIT} from '../src/jump-chat-state';
import type {JumpChatMessage} from '../shared/jump-social';

const message=(id:number):JumpChatMessage=>({id:`chat-${id}`,playerId:'friend',nickname:'등반친구',text:`같이 올라가요 ${id}`,sentAt:1000+id,expiresAt:9000+id});

test('tower history and live acknowledgements merge once in chronological order',()=>{
  const original=message(2),live=mergeJumpChats([],[original,message(3)]);
  const result=mergeJumpChats(live,[message(1),{...original,text:'duplicate changed text'},message(3)]);
  assert.deepEqual(result.map(item=>item.id),['chat-1','chat-2','chat-3']);
  assert.strictEqual(result[1],original,'an old history packet cannot rewrite a displayed live message');
  assert.equal(live.length,2,'merging must not mutate the previous displayed list');
});

test('tower chat bounds retained messages while preserving the latest forty on reconnect',()=>{
  const messages=Array.from({length:65},(_,index)=>message(index));
  const result=mergeJumpChats(messages.slice(0,30),messages.slice(20));
  assert.equal(result.length,40);assert.equal(result[0].id,'chat-25');assert.equal(result.at(-1)?.id,'chat-64');
  assert.deepEqual(mergeJumpChats(result,messages),result,'a repeated full history does not add duplicates');
});

test('tower drafts normalize Korean composition and whitespace without counting emoji as two characters',()=>{
  assert.equal(jumpChatDraft('  가즈아!\n 같이\t올라가요  '),'가즈아! 같이 올라가요');
  const emoji='😀'.repeat(JUMP_CHAT_LIMIT);assert.equal([...jumpChatDraft(emoji)].length,80);
  assert.equal([...jumpChatDraft(emoji+'!')].length,81,'the composer can block an over-limit draft before sending');
});

test('malformed history entries do not replace a valid chat list',()=>{
  const valid=message(1);
  const invalid=[null,{...message(2),sentAt:NaN},{...message(3),text:12}] as unknown as JumpChatMessage[];
  assert.deepEqual(mergeJumpChats([valid],invalid),[valid]);
});
