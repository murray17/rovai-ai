const assert=require('node:assert/strict')
module.exports=async({window,run,click,settle,waitFor,navigate,capture,noOverflow})=>{
 const input=async(selector,value)=>{await run(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,${JSON.stringify(value)});n.dispatchEvent(new Event('input',{bubbles:true}))})()`);await settle()}
 const text=()=>run('document.body.textContent')
 const save='button[type="submit"]'
 await navigate('claude-code-cli');await waitFor('document.querySelector("input[type=url]")')
 assert.equal(await run(`document.querySelector(${JSON.stringify(save)}).disabled`),true,'native first read does not require saving')
 assert.ok((await text()).includes('已从原生配置读取，无需重新输入。'))
 assert.equal(await run('document.querySelector(".runtime-custom-api-key-input input").value'),'')
 assert.ok(!(await text()).includes('重新读取'))
 await input('input[type=url]','https://relay.example/other-prefix')
 await click(save)
 assert.equal(await run('window.settingsTest.requests.at(-1).params.apiKey.action'),'keep','URL editing preserves static key')
 await input('.runtime-custom-api-key-input input','fixture-new-key')
 await click('.runtime-key-visibility')
 assert.equal(await run('document.querySelector(".runtime-custom-api-key-input input").type'),'text')
 await input('.runtime-custom-api-key-input input','')
 assert.equal(await run('document.querySelector(".runtime-custom-api-key-input input").type'),'password')
 await input('.runtime-custom-api-key-input input','fixture-new-key')
 await run(`window.settingsTest.state.failure='runtime.startup.save'`)
 await click(save);assert.equal(await run('document.querySelector(".runtime-custom-api-key-input input").value'),'fixture-new-key')
 await click(save);assert.equal(await run('document.querySelector(".runtime-custom-api-key-input input").value'),'')
 await click('input[value="official_login"]')
 assert.ok((await text()).includes('已登录'));assert.ok((await text()).includes('在本机终端运行'));assert.ok(!(await text()).includes('Host'))
 await click(save);await click('input[value="custom_api"]');await click(save)
 // An unrelated external update is retained while an edited field reports a real conflict.
 await input('input[type=url]','https://mine.example/prefix')
 await run(`window.settingsTest.state.startup['claude-code-cli'].configuration.customApi.baseUrl='https://external.example/prefix';window.settingsTest.state.startup['claude-code-cli'].configuration.environment=[{name:'EXTERNAL',value:'preserve'}]`)
 await click(save);await waitFor('document.querySelector(".runtime-save-conflict")')
 assert.equal(await run('document.querySelector("input[type=url]").value'),'https://mine.example/prefix')
 assert.ok((await text()).includes('https://external.example/prefix'))
 await capture('claude-field-conflict')
 await click('.runtime-conflict-actions button:first-child');await click(save)
 assert.equal(await run("window.settingsTest.state.startup['claude-code-cli'].configuration.environment[0].name"),'EXTERNAL')
 await navigate();await navigate('codex-cli');await waitFor('document.querySelector(".runtime-api-model-row")')
 const row='.runtime-api-model-row:first-of-type input'
 const id='.runtime-api-model-row input[aria-label="模型 ID 1"]'
 await run(`window.rowBefore=document.querySelector('[data-model-row="one"]');document.querySelector(${JSON.stringify(id)}).focus()`)
 await input(id,'');assert.equal(await run('document.querySelector("input[type=radio][name$=default]:checked").closest(".runtime-api-model-row").dataset.modelRow'),'one')
 for(const value of ['r','re','renamed']) {await input(id,value);assert.equal(await run('document.querySelector("[data-model-row=one]")===window.rowBefore'),true);assert.equal(await run('document.activeElement.getAttribute("aria-label")'),'模型 ID 1')}
 await click(save)
 assert.equal(await run("window.settingsTest.state.startup['codex-cli'].configuration.customApi.defaultModel"),'renamed')
 await click('[data-model-row="one"] button');assert.ok((await text()).includes('请先指定新的默认模型'))
 await input('.runtime-api-model-row input[aria-label="模型 ID 2"]','renamed');await click(save);assert.ok((await text()).includes('不能重复'))
 await input('.runtime-api-model-row input[aria-label="模型 ID 2"]','model-b');
 await click('[data-model-row="two"] input[type=radio]');await click('[data-model-row="one"] button');await click(save)
 assert.equal(await run("window.settingsTest.state.startup['codex-cli'].configuration.customApi.models.length"),1)
 for(const theme of ['day','night']){await run(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);await settle();await noOverflow(theme);await capture('codex-'+theme)}
 window.setContentSize(520,920);await settle();await noOverflow('compact');await capture('codex-compact')
 await navigate();await run(`window.settingsTest.state.failure='runtime.startup.get'`);await navigate('claude-code-cli');await waitFor('document.querySelector(".runtime-native-read-error")');await click('.runtime-native-read-error button');await waitFor('document.querySelector("input[type=url]")')
 await click('.runtime-key-clear');await click(save);assert.equal(await run("window.settingsTest.state.startup['claude-code-cli'].credential.status"),'missing')
 assert.ok(!(await text()).includes('测试 API'))
}
