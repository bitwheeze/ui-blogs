import { fork, call, put, select } from 'redux-saga/effects';
import { getNotifications } from 'app/utils/ServerApiClient';
import registerServiceWorker from 'app/utils/RegisterServiceWorker';

const wait = ms => (
    new Promise(resolve => {
        setTimeout(() => resolve(), ms)
    })
)

let webpush_params = null;

export default function* pollData() {
    while(true) {
        //yield call(wait, 20000);
        yield call(wait, 10000);

        const username = yield select(state => state.user.getIn(['current', 'username']));
        if (username) {
            /*if (webpush_params === null) {
                try {
                    webpush_params = yield call(registerServiceWorker);
                    if (webpush_params) yield call(webPushRegister, username, webpush_params);
                } catch (error) {
                    console.error(error);
                    webpush_params = {error};
                }
            }*/
            const nc = yield call(getNotifications, username, webpush_params);
            yield put({type: 'UPDATE_NOTIFICOUNTERS', payload: nc});
        }
    }
}
