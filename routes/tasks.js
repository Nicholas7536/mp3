const express = require('express');
const Task = require('../models/task');
const User = require('../models/user');
const { isValidObjectId, parseJsonParam, parseQueryParams } = require('./helpers');

module.exports = function (router) {
    const tasksRoute = router.route('/tasks');
    const taskDetailRoute = router.route('/tasks/:id');

    // GET /api/tasks
    tasksRoute.get(async function (req, res) {
        try {
            const queryParsed = parseQueryParams(req, 100); // default 100 for tasks
            if (!queryParsed.success) {
                return res.status(400).json({ message: 'Bad Request', data: queryParsed.error });
            }

            if (queryParsed.count) {
                const count = await Task.countDocuments(queryParsed.where);
                return res.status(200).json({ message: 'OK', data: count });
            }

            let query = Task.find(queryParsed.where);
            if (queryParsed.sort) query = query.sort(queryParsed.sort);
            if (queryParsed.select) query = query.select(queryParsed.select);
            if (queryParsed.skip !== undefined) query = query.skip(queryParsed.skip);
            if (queryParsed.limit !== undefined) query = query.limit(queryParsed.limit);

            const tasks = await query.exec();
            return res.status(200).json({ message: 'OK', data: tasks });
        } catch (err) {
            return res.status(500).json({ message: 'Internal Server Error', data: 'An unexpected error occurred' });
        }
    });

    // POST /api/tasks
    tasksRoute.post(async function (req, res) {
        try {
            const { name, description, deadline, completed, assignedUser, assignedUserName } = req.body;

            // Validation order: field format and values (400)
            if (!name || typeof name !== 'string' || name.trim() === '') {
                return res.status(400).json({ message: 'Bad Request', data: 'Name is required and must be a string' });
            }
            if (!deadline || isNaN(Date.parse(deadline))) {
                return res.status(400).json({ message: 'Bad Request', data: 'Valid deadline is required' });
            }

            let isCompleted = false;
            if (completed !== undefined) {
                if (typeof completed === 'boolean') {
                    isCompleted = completed;
                } else if (completed === 'true' || completed === 'false') {
                    isCompleted = completed === 'true';
                } else {
                    return res.status(400).json({ message: 'Bad Request', data: 'completed must be a boolean' });
                }
            }

            let resolvedAssignedUser = '';
            let resolvedAssignedUserName = 'unassigned';

            if (assignedUser !== undefined && assignedUser !== null && assignedUser !== '') {
                if (!isValidObjectId(assignedUser)) {
                    return res.status(400).json({ message: 'Bad Request', data: 'Invalid assignedUser ID format' });
                }

                // Check whether referenced user exists (404)
                const userDoc = await User.findById(assignedUser);
                if (!userDoc) {
                    return res.status(404).json({ message: 'Not Found', data: 'Assigned user does not exist' });
                }

                // Check assignedUserName match
                if (assignedUserName !== undefined && assignedUserName !== null && assignedUserName !== '') {
                    if (assignedUserName !== userDoc.name) {
                        return res.status(400).json({ message: 'Bad Request', data: 'assignedUserName does not match the assigned user\'s name' });
                    }
                }
                resolvedAssignedUser = userDoc._id.toString();
                resolvedAssignedUserName = userDoc.name;
            } else {
                if (assignedUserName !== undefined && assignedUserName !== null && assignedUserName !== '' && assignedUserName !== 'unassigned') {
                    return res.status(400).json({ message: 'Bad Request', data: 'Cannot set assignedUserName without a valid assignedUser' });
                }
            }

            const newTask = new Task({
                name: name.trim(),
                description: typeof description === 'string' ? description : '',
                deadline: new Date(deadline),
                completed: isCompleted,
                assignedUser: resolvedAssignedUser,
                assignedUserName: resolvedAssignedUserName,
                dateCreated: new Date()
            });

            await newTask.save();

            // Reconcile two-way reference: add to user's pendingTasks if assigned and pending
            if (resolvedAssignedUser && !isCompleted) {
                await User.updateOne(
                    { _id: resolvedAssignedUser },
                    { $addToSet: { pendingTasks: newTask._id.toString() } }
                );
            }

            return res.status(201).json({ message: 'Task created', data: newTask });
        } catch (err) {
            return res.status(500).json({ message: 'Internal Server Error', data: 'An unexpected error occurred' });
        }
    });

    // GET /api/tasks/:id
    taskDetailRoute.get(async function (req, res) {
        try {
            if (!isValidObjectId(req.params.id)) {
                return res.status(404).json({ message: 'Not Found', data: 'Task not found' });
            }

            let selectOption;
            if (req.query.select !== undefined) {
                const selectParsed = parseJsonParam(req.query.select, 'select');
                if (!selectParsed.success) {
                    return res.status(400).json({ message: 'Bad Request', data: selectParsed.error });
                }
                selectOption = selectParsed.value;
            }

            let query = Task.findById(req.params.id);
            if (selectOption) query = query.select(selectOption);

            const task = await query.exec();
            if (!task) {
                return res.status(404).json({ message: 'Not Found', data: 'Task not found' });
            }

            return res.status(200).json({ message: 'OK', data: task });
        } catch (err) {
            return res.status(500).json({ message: 'Internal Server Error', data: 'An unexpected error occurred' });
        }
    });

    // PUT /api/tasks/:id
    taskDetailRoute.put(async function (req, res) {
        try {
            // Check 1: URL id (404)
            if (!isValidObjectId(req.params.id)) {
                return res.status(404).json({ message: 'Not Found', data: 'Task not found' });
            }

            const task = await Task.findById(req.params.id);
            if (!task) {
                return res.status(404).json({ message: 'Not Found', data: 'Task not found' });
            }

            // Check 2: field format and values (400)
            const { name, description, deadline, completed, assignedUser, assignedUserName } = req.body;
            if (!name || typeof name !== 'string' || name.trim() === '') {
                return res.status(400).json({ message: 'Bad Request', data: 'Name is required and must be a string' });
            }
            if (!deadline || isNaN(Date.parse(deadline))) {
                return res.status(400).json({ message: 'Bad Request', data: 'Valid deadline is required' });
            }

            let isCompleted = false;
            if (completed !== undefined) {
                if (typeof completed === 'boolean') {
                    isCompleted = completed;
                } else if (completed === 'true' || completed === 'false') {
                    isCompleted = completed === 'true';
                } else {
                    return res.status(400).json({ message: 'Bad Request', data: 'completed must be a boolean' });
                }
            }

            let resolvedAssignedUser = '';
            let resolvedAssignedUserName = 'unassigned';

            if (assignedUser !== undefined && assignedUser !== null && assignedUser !== '') {
                if (!isValidObjectId(assignedUser)) {
                    return res.status(400).json({ message: 'Bad Request', data: 'Invalid assignedUser ID format' });
                }

                // Check 3: whether referenced user exists (404)
                const userDoc = await User.findById(assignedUser);
                if (!userDoc) {
                    return res.status(404).json({ message: 'Not Found', data: 'Assigned user does not exist' });
                }

                // Check assignedUserName match
                if (assignedUserName !== undefined && assignedUserName !== null && assignedUserName !== '') {
                    if (assignedUserName !== userDoc.name) {
                        return res.status(400).json({ message: 'Bad Request', data: 'assignedUserName does not match the assigned user\'s name' });
                    }
                }
                resolvedAssignedUser = userDoc._id.toString();
                resolvedAssignedUserName = userDoc.name;
            } else {
                if (assignedUserName !== undefined && assignedUserName !== null && assignedUserName !== '' && assignedUserName !== 'unassigned') {
                    return res.status(400).json({ message: 'Bad Request', data: 'Cannot set assignedUserName without a valid assignedUser' });
                }
            }

            const oldAssignedUser = task.assignedUser;
            const newAssignedUser = resolvedAssignedUser;

            task.name = name.trim();
            task.description = typeof description === 'string' ? description : '';
            task.deadline = new Date(deadline);
            task.completed = isCompleted;
            task.assignedUser = resolvedAssignedUser;
            task.assignedUserName = resolvedAssignedUserName;
            // dateCreated is preserved unchanged
            await task.save();

            // Reconcile two-way references
            if (oldAssignedUser && oldAssignedUser !== newAssignedUser) {
                // Task reassigned or unassigned: remove from old user's pendingTasks
                await User.updateOne(
                    { _id: oldAssignedUser },
                    { $pull: { pendingTasks: task._id.toString() } }
                );
            }

            if (newAssignedUser) {
                if (isCompleted) {
                    // Completed tasks must not be in pendingTasks
                    await User.updateOne(
                        { _id: newAssignedUser },
                        { $pull: { pendingTasks: task._id.toString() } }
                    );
                } else {
                    // Pending task added to assigned user's pendingTasks
                    await User.updateOne(
                        { _id: newAssignedUser },
                        { $addToSet: { pendingTasks: task._id.toString() } }
                    );
                }
            }

            return res.status(200).json({ message: 'Task updated', data: task });
        } catch (err) {
            return res.status(500).json({ message: 'Internal Server Error', data: 'An unexpected error occurred' });
        }
    });

    // DELETE /api/tasks/:id
    taskDetailRoute.delete(async function (req, res) {
        try {
            if (!isValidObjectId(req.params.id)) {
                return res.status(404).json({ message: 'Not Found', data: 'Task not found' });
            }

            const task = await Task.findById(req.params.id);
            if (!task) {
                return res.status(404).json({ message: 'Not Found', data: 'Task not found' });
            }

            // If task was assigned, remove from that user's pendingTasks
            if (task.assignedUser) {
                await User.updateOne(
                    { _id: task.assignedUser },
                    { $pull: { pendingTasks: task._id.toString() } }
                );
            }

            await Task.deleteOne({ _id: task._id });

            return res.status(204).send();
        } catch (err) {
            return res.status(500).json({ message: 'Internal Server Error', data: 'An unexpected error occurred' });
        }
    });

    return router;
};

