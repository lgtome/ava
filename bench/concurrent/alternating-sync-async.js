import test from '../../';

for (var i = 0; i < 10000; i++) {
	if (i % 2) {
		test('test' + i, () => new Promise(resolve => setImmediate(resolve)));
	} else {
		test('test' + i, () => {});
	}
}
